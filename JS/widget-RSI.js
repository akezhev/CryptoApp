(function() {
  'use strict';

  // ==================== КОНФИГУРАЦИЯ ====================
  const CONFIG = {
    // Основные криптоактивы
    assets: [
      { symbol: 'BTCUSDT', name: 'BTC', color: '#f7931a', icon: '₿' },
      { symbol: 'ETHUSDT', name: 'ETH', color: '#627eea', icon: 'Ξ' },
      { symbol: 'SOLUSDT', name: 'SOL', color: '#14f195', icon: '◎' },
      { symbol: 'XRPUSDT', name: 'XRP', color: '#23292f', icon: '✕' },
      { symbol: 'ADAUSDT', name: 'ADA', color: '#0033ad', icon: '₳' },
      { symbol: 'DOGEUSDT', name: 'DOGE', color: '#c2a633', icon: 'Ð' }
    ],

    // Таймфреймы для анализа
    timeframes: [
      { label: '5m', interval: '5m', period: 14 },
      { label: '15m', interval: '15m', period: 14 },
      { label: '1h', interval: '1h', period: 14 }
    ],

    // Пороговые значения RSI
    rsiOversold: 15,    // RSI < 15 = сигнал на покупку (лонг)
    rsiOverbought: 85,  // RSI > 85 = сигнал на продажу (шорт)

    // Кэширование
    cacheKey: 'rsi_widget_cache_v2',
    cacheTtl: 5 * 60 * 1000, // 5 минут
    cacheSaveInterval: 30000,  // Сохранять каждые 30 сек

    // WebSocket
    wsReconnectDelay: 5000,
    wsUrl: 'wss://stream.binance.com:9443/stream',
    restUrl: 'https://api.binance.com/api/v3/klines',

    // RSI
    rsiPeriod: 14,
    historyLimit: 100 // Количество свечей для загрузки
  };

  // ==================== СОСТОЯНИЕ ====================
  const state = {
    ws: null,
    candlesData: {},
    currentPrices: {},
    reconnectTimer: null,
    isConnected: false,
    lastRender: 0,
    initComplete: false
  };

  // Инициализация структуры данных
  CONFIG.assets.forEach(asset => {
    state.candlesData[asset.symbol] = {};
    CONFIG.timeframes.forEach(tf => {
      state.candlesData[asset.symbol][tf.interval] = [];
    });
  });

  // ==================== КЭШИРОВАНИЕ (localStorage) ====================

  /**
   * Загружает кэшированные данные из localStorage
   * @returns {boolean} true если кэш валиден и загружен
   */
  function loadCache() {
    try {
      const cached = localStorage.getItem(CONFIG.cacheKey);
      if (!cached) return false;

      const data = JSON.parse(cached);
      const age = Date.now() - (data.timestamp || 0);

      if (age < CONFIG.cacheTtl && data.candlesData && data.currentPrices) {
        // Восстанавливаем данные
        Object.keys(data.candlesData).forEach(symbol => {
          if (state.candlesData[symbol]) {
            Object.keys(data.candlesData[symbol]).forEach(interval => {
              state.candlesData[symbol][interval] = data.candlesData[symbol][interval] || [];
            });
          }
        });
        state.currentPrices = data.currentPrices || {};
        console.log('[RSI Widget] Кэш загружен, возраст:', Math.round(age / 1000), 'сек');
        return true;
      }
    } catch (e) {
      console.warn('[RSI Widget] Ошибка загрузки кэша:', e);
      localStorage.removeItem(CONFIG.cacheKey);
    }
    return false;
  }

  /**
   * Сохраняет текущие данные в localStorage
   */
  function saveCache() {
    try {
      localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
        candlesData: state.candlesData,
        currentPrices: state.currentPrices,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('[RSI Widget] Ошибка сохранения кэша:', e);
    }
  }

  // ==================== РАСЧЕТ RSI ====================

  /**
   * Рассчитывает RSI по массиву цен закрытия
   * Использует Wilder's Smoothing Method (EMA-подобное)
   * @param {number[]} closes - массив цен закрытия
   * @param {number} period - период RSI (по умолчанию 14)
   * @returns {number|null} значение RSI или null если данных недостаточно
   */
  function calculateRSI(closes, period) {
    period = period || CONFIG.rsiPeriod;

    if (!closes || closes.length < period + 1) {
      return null;
    }

    let gains = 0;
    let losses = 0;

    // Первоначальное среднее (SMA за period)
    for (let i = 1; i <= period; i++) {
      const change = closes[closes.length - i] - closes[closes.length - i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Wilder's smoothing для оставшихся периодов
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[closes.length - i] - closes[closes.length - i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.round(rsi * 10) / 10; // Округляем до 1 знака
  }

  // ==================== ЗАГРУЗКА ДАННЫХ ====================

  /**
   * Загружает исторические свечи через REST API Binance
   * @param {string} symbol - торговая пара (например BTCUSDT)
   * @param {string} interval - интервал (5m, 15m, 1h)
   * @param {number} limit - количество свечей
   * @returns {Array|null} массив свечей или null при ошибке
   */
  async function fetchHistoricalCandles(symbol, interval, limit) {
    try {
      const url = `${CONFIG.restUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Формат ответа Binance: [time, open, high, low, close, volume, ...]
      return data.map(c => ({
        openTime: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
        closeTime: c[6]
      }));
    } catch (e) {
      console.error(`[RSI Widget] Ошибка загрузки ${symbol} ${interval}:`, e.message);
      return null;
    }
  }

  /**
   * Инициализирует исторические данные для всех активов и таймфреймов
   */
  async function initHistoricalData() {
    const promises = [];

    CONFIG.assets.forEach(asset => {
      CONFIG.timeframes.forEach(tf => {
        promises.push(
          fetchHistoricalCandles(asset.symbol, tf.interval, CONFIG.historyLimit)
            .then(candles => {
              if (candles && candles.length > 0) {
                state.candlesData[asset.symbol][tf.interval] = candles;
              }
            })
        );
      });
    });

    await Promise.all(promises);
    saveCache();
    render();

    console.log('[RSI Widget] Исторические данные загружены');
  }

  // ==================== WEBSOCKET ====================

  /**
   * Формирует URL для combined WebSocket stream
   * @returns {string} WebSocket URL
   */
  function buildWsUrl() {
    const streams = [];

    CONFIG.assets.forEach(asset => {
      // Потоки свечей для всех таймфреймов
      CONFIG.timeframes.forEach(tf => {
        streams.push(`${asset.symbol.toLowerCase()}@kline_${tf.interval}`);
      });
      // Поток тикера для текущей цены
      streams.push(`${asset.symbol.toLowerCase()}@ticker`);
    });

    return `${CONFIG.wsUrl}?streams=${streams.join('/')}`;
  }

  /**
   * Подключается к WebSocket Binance
   */
  function connectWebSocket() {
    // Закрываем предыдущее соединение если есть
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
      state.ws = null;
    }

    updateStatus('connecting', 'Подключение...');

    const wsUrl = buildWsUrl();
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      state.isConnected = true;
      updateStatus('connected', 'Online');
      console.log('[RSI Widget] WebSocket подключен');
    };

    state.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (e) {
        console.error('[RSI Widget] Ошибка парсинга WS:', e);
      }
    };

    state.ws.onclose = () => {
      state.isConnected = false;
      updateStatus('disconnected', 'Offline');
      console.log('[RSI Widget] WebSocket отключен, переподключение через 5 сек...');
      state.reconnectTimer = setTimeout(connectWebSocket, CONFIG.wsReconnectDelay);
    };

    state.ws.onerror = (err) => {
      console.error('[RSI Widget] WS ошибка:', err);
      state.ws.close();
    };
  }

  /**
   * Обрабатывает входящие сообщения WebSocket
   * @param {Object} message - сообщение от Binance
   */
  function handleWebSocketMessage(message) {
    if (!message || !message.data || !message.stream) return;

    const data = message.data;
    const stream = message.stream;

    // Обновление тикера (текущая цена)
    if (stream.includes('@ticker')) {
      state.currentPrices[data.s] = {
        price: parseFloat(data.c),
        change24h: parseFloat(data.P),
        high24h: parseFloat(data.h),
        low24h: parseFloat(data.l),
        volume24h: parseFloat(data.v),
        time: Date.now()
      };
      return;
    }

    // Обновление свечи (kline)
    if (stream.includes('@kline_')) {
      const symbol = data.s;
      const interval = data.k.i;
      const kline = data.k;

      if (!state.candlesData[symbol] || !state.candlesData[symbol][interval]) {
        return;
      }

      const candles = state.candlesData[symbol][interval];
      const newCandle = {
        openTime: kline.t,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v),
        closeTime: kline.T,
        isClosed: kline.x
      };

      const lastCandle = candles[candles.length - 1];

      if (lastCandle && lastCandle.openTime === newCandle.openTime) {
        // Обновляем текущую открытую свечу
        candles[candles.length - 1] = newCandle;
      } else if (!lastCandle || newCandle.openTime > lastCandle.openTime) {
        // Новая свеча началась
        if (candles.length >= 200) {
          candles.shift(); // Удаляем старую, сохраняем размер
        }
        candles.push(newCandle);
      }

      // Сохраняем кэш с вероятностью 10% (чтобы не нагружать localStorage)
      if (Math.random() < 0.1) {
        saveCache();
      }

      // Рендерим с throttle (макс 5 раз в секунду)
      const now = Date.now();
      if (now - state.lastRender > 200) {
        state.lastRender = now;
        render();
      }
    }
  }

  // ==================== UI ====================

  /**
   * Обновляет статус подключения в UI
   */
  function updateStatus(type, text) {
    const statusEl = document.getElementById('wsStatus');
    const statusText = document.getElementById('wsStatusText');
    if (!statusEl || !statusText) return;

    statusEl.className = `rsi-widget-status status-${type}`;
    statusText.textContent = text;
  }

  /**
   * Форматирует цену в зависимости от величины
   */
  function formatPrice(price) {
    if (!price && price !== 0) return '—';
    if (price >= 1000) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (price >= 1) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    } else {
      return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    }
  }

  /**
   * Рендерит основной интерфейс виджета
   */
  function render() {
    const container = document.getElementById('assetsContainer');
    if (!container) return;

    let html = '';

    CONFIG.assets.forEach(asset => {
      const priceData = state.currentPrices[asset.symbol];
      const price = formatPrice(priceData ? priceData.price : null);

      const priceChange = priceData ? priceData.change24h : 0;
      const priceColor = priceChange >= 0 ? '#3fb950' : '#f85149';
      const priceSign = priceChange >= 0 ? '+' : '';

      html += `
        <div class="rsi-asset-row">
          <div class="rsi-asset-info">
            <div class="rsi-asset-icon" style="background: ${asset.color};">
              ${asset.icon}
            </div>
            <div>
              <div class="rsi-asset-name">${asset.name}</div>
              <div class="rsi-asset-price">
                $${price} 
                <span style="color: ${priceColor};">${priceSign}${priceChange.toFixed(2)}%</span>
              </div>
            </div>
          </div>
          <div class="rsi-timeframes">
      `;

      CONFIG.timeframes.forEach(tf => {
        const candles = state.candlesData[asset.symbol][tf.interval];
        let rsi = null;
        let rsiClass = 'rsi-normal';
        let signalBadge = '';
        let tooltipText = 'Нейтрально';

        if (candles && candles.length > tf.period) {
          const closes = candles.map(c => c.close);
          rsi = calculateRSI(closes, tf.period);

          if (rsi !== null) {
            if (rsi <= CONFIG.rsiOversold) {
              rsiClass = 'rsi-oversold';
              signalBadge = '<div class="rsi-signal-badge signal-buy">▲</div>';
              tooltipText = `СИГНАЛ ЛОНГ! RSI = ${rsi.toFixed(1)} (перепроданность)`;
            } else if (rsi >= CONFIG.rsiOverbought) {
              rsiClass = 'rsi-overbought';
              signalBadge = '<div class="rsi-signal-badge signal-sell">▼</div>';
              tooltipText = `СИГНАЛ ШОРТ! RSI = ${rsi.toFixed(1)} (перекупленность)`;
            } else {
              tooltipText = `RSI = ${rsi.toFixed(1)} — нейтрально`;
            }
          }
        }

        const rsiText = rsi !== null ? rsi.toFixed(1) : '—';

        html += `
          <div class="rsi-tf-block">
            <div class="rsi-tooltip">${tooltipText}</div>
            <div class="rsi-tf-label">${tf.label}</div>
            <div class="rsi-value ${rsiClass}">
              ${rsiText}
              ${signalBadge}
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Обновляем время последнего обновления
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
      lastUpdate.textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');
    }
  }

  /**
   * Показывает ошибку в UI
   */
  function showError(message) {
    const container = document.getElementById('assetsContainer');
    if (container) {
      container.innerHTML = `
        <div class="rsi-error">
          <div>⚠️ ${message}</div>
          <button onclick="RSIWidget.reconnect()">Переподключиться</button>
        </div>
      `;
    }
  }

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================

  async function init() {
    console.log('[RSI Widget] Инициализация...');

    // Пробуем загрузить кэш
    const hasCache = loadCache();
    if (hasCache) {
      render();
    }

    try {
      // Загружаем исторические данные
      await initHistoricalData();
      state.initComplete = true;

      // Подключаем WebSocket для real-time данных
      connectWebSocket();

      // Сохраняем кэш при закрытии страницы
      window.addEventListener('beforeunload', saveCache);

      // Периодическое сохранение кэша
      setInterval(saveCache, CONFIG.cacheSaveInterval);

      // Периодический рендер (на случай если WS не присылает данные)
      setInterval(() => {
        if (state.isConnected) render();
      }, 5000);

    } catch (e) {
      console.error('[RSI Widget] Ошибка инициализации:', e);
      showError('Ошибка загрузки данных. Проверьте соединение.');
    }
  }

  // Запуск
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ==================== ПУБЛИЧНЫЙ API ====================

  window.RSIWidget = {
    /** Принудительно обновить исторические данные */
    refresh: async () => {
      await initHistoricalData();
    },

    /** Отключить WebSocket */
    disconnect: () => {
      if (state.ws) {
        state.ws.close();
        state.ws = null;
      }
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      state.isConnected = false;
      updateStatus('disconnected', 'Отключено');
    },

    /** Переподключить WebSocket */
    reconnect: () => {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
      }
      connectWebSocket();
    },

    /** Получить текущие данные */
    getData: () => ({
      assets: CONFIG.assets,
      candles: state.candlesData,
      prices: state.currentPrices,
      isConnected: state.isConnected
    }),

    /** Очистить кэш */
    clearCache: () => {
      localStorage.removeItem(CONFIG.cacheKey);
      console.log('[RSI Widget] Кэш очищен');
    },

    /** Получить конфигурацию */
    getConfig: () => ({ ...CONFIG })
  };

})();