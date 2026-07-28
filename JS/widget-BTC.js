// widget-BTC
    // ═══════════════════════════════════════════════════════
    //  BITCOIN WIDGET — ОПТИМИЗИРОВАННАЯ ВЕРСИЯ С КЭШИРОВАНИЕМ
    // ═══════════════════════════════════════════════════════

    const CONFIG = {
      COIN_ID: 'bitcoin',
      VS_CURRENCY: 'usd',
      API_BASE: 'https://api.coingecko.com/api/v3',
      // === НАСТРОЙКИ КЭША ===
      CACHE_TTL: {
          MARKET: 60 * 1000,      // Цена: 1 минута
          CHART_1D: 60 * 1000,    // 24ч: 1 минута
          CHART_7D: 5 * 60 * 1000,   // 7д: 5 минут
          CHART_30D: 10 * 60 * 1000, // 30д: 10 минут
          CHART_90D: 30 * 60 * 1000, // 3м: 30 минут
          CHART_365D: 60 * 60 * 1000 // 1г: 1 час
      },
      // === НАСТРОЙКИ API ===
      REQUEST_DELAY: 1200,        // Минимальная задержка между запросами (мс)
      MAX_RETRIES: 3,             // Максимум повторных попыток
      RETRY_DELAY_BASE: 2000,     // Базовая задержка перед retry (мс)
      AUTO_REFRESH_INTERVAL: 30 * 1000, // Автообновление каждые 30 сек
  };

  // === ГЛОБАЛЬНОЕ СОСТОЯНИЕ ===
  const state = {
      chartInstance: null,
      currentDays: 1,
      lastRequestTime: 0,
      isLoading: false,
      autoRefreshTimer: null,
      cache: new Map(),
      requestQueue: [],
      isProcessingQueue: false,
  };

  // ═══════════════════════════════════════════════════════
  //  СИСТЕМА КЭШИРОВАНИЯ
  // ═══════════════════════════════════════════════════════

  function getCacheKey(type, params = '') {
      return `${type}_${params}`;
  }

  function getCacheTTL(days) {
      if (days <= 1) return CONFIG.CACHE_TTL.CHART_1D;
      if (days <= 7) return CONFIG.CACHE_TTL.CHART_7D;
      if (days <= 30) return CONFIG.CACHE_TTL.CHART_30D;
      if (days <= 90) return CONFIG.CACHE_TTL.CHART_90D;
      return CONFIG.CACHE_TTL.CHART_365D;
  }

  function getCached(key) {
      const entry = state.cache.get(key);
      if (!entry) return null;
      const now = Date.now();
      if (now - entry.timestamp > entry.ttl) {
          state.cache.delete(key);
          return null;
      }
      return entry.data;
  }

  function setCached(key, data, ttl) {
      state.cache.set(key, {
          data: JSON.parse(JSON.stringify(data)), // Глубокая копия
          timestamp: Date.now(),
          ttl: ttl
      });
  }

  function clearExpiredCache() {
      const now = Date.now();
      for (const [key, entry] of state.cache) {
          if (now - entry.timestamp > entry.ttl) {
              state.cache.delete(key);
          }
      }
  }

  // Очистка устаревшего кэша каждые 5 минут
  setInterval(clearExpiredCache, 5 * 60 * 1000);

  // ═══════════════════════════════════════════════════════
  //  УМНАЯ СИСТЕМА ЗАПРОСОВ С ОЧЕРЕДЬЮ И RETRY
  // ═══════════════════════════════════════════════════════

  async function smartFetch(url, options = {}) {
      const { priority = 0, retries = CONFIG.MAX_RETRIES, retryDelay = CONFIG.RETRY_DELAY_BASE } = options;

      return new Promise((resolve, reject) => {
          state.requestQueue.push({
              url,
              resolve,
              reject,
              priority,
              retries,
              retryDelay,
              attempt: 0
          });
          state.requestQueue.sort((a, b) => b.priority - a.priority);
          processQueue();
      });
  }

  async function processQueue() {
      if (state.isProcessingQueue || state.requestQueue.length === 0) return;
      state.isProcessingQueue = true;

      while (state.requestQueue.length > 0) {
          const now = Date.now();
          const timeSinceLastRequest = now - state.lastRequestTime;
          if (timeSinceLastRequest < CONFIG.REQUEST_DELAY) {
              await sleep(CONFIG.REQUEST_DELAY - timeSinceLastRequest);
          }

          const req = state.requestQueue.shift();
          state.lastRequestTime = Date.now();

          try {
              const response = await fetchWithRetry(req);
              req.resolve(response);
          } catch (err) {
              req.reject(err);
          }
      }

      state.isProcessingQueue = false;
  }

  async function fetchWithRetry(req) {
      while (req.attempt <= req.retries) {
          try {
              const response = await fetch(req.url);
              
              // Обработка лимита запросов (429)
              if (response.status === 429) {
                  const retryAfter = response.headers.get('Retry-After');
                  const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : req.retryDelay * Math.pow(2, req.attempt);
                  console.warn(`Rate limit! Ждём ${waitTime}мс...`);
                  updateStatus('cached', 'Лимит API, ждём...');
                  await sleep(waitTime);
                  req.attempt++;
                  continue;
              }

              if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }

              return await response.json();

          } catch (err) {
              req.attempt++;
              if (req.attempt > req.retries) throw err;
              
              const waitTime = req.retryDelay * Math.pow(2, req.attempt - 1);
              console.warn(`Ошибка запроса, попытка ${req.attempt}/${req.retries + 1} через ${waitTime}мс`);
              updateStatus('cached', `Ошибка, повтор ${req.attempt}...`);
              await sleep(waitTime);
          }
      }
  }

  function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════
  //  ЗАГРУЗКА ДАННЫХ С КЭШИРОВАНИЕМ
  // ═══════════════════════════════════════════════════════

  async function fetchMarketData(forceRefresh = false) {
      const cacheKey = getCacheKey('market');
      
      if (!forceRefresh) {
          const cached = getCached(cacheKey);
          if (cached) {
              console.log('✅ Использован кэш market data');
              updateStatus('cached', 'Данные из кэша');
              return cached;
          }
      }

      const data = await smartFetch(
          `${CONFIG.API_BASE}/coins/${CONFIG.COIN_ID}?vs_currency=${CONFIG.VS_CURRENCY}`,
          { priority: 2 } // Высокий приоритет
      );

      setCached(cacheKey, data, CONFIG.CACHE_TTL.MARKET);
      return data;
  }

  async function fetchChartData(days, forceRefresh = false) {
      const cacheKey = getCacheKey('chart', days);
      
      if (!forceRefresh) {
          const cached = getCached(cacheKey);
          if (cached) {
              console.log(`✅ Использован кэш графика ${days}д`);
              updateStatus('cached', `График ${days}д из кэша`);
              return cached;
          }
      }

      const data = await smartFetch(
          `${CONFIG.API_BASE}/coins/${CONFIG.COIN_ID}/market_chart?vs_currency=${CONFIG.VS_CURRENCY}&days=${days}`,
          { priority: 1 } // Средний приоритет
      );

      setCached(cacheKey, data.prices, getCacheTTL(days));
      return data.prices;
  }

  // ═══════════════════════════════════════════════════════
  //  ФОРМАТИРОВАНИЕ
  // ═══════════════════════════════════════════════════════

  function formatPrice(price) {
      return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: price < 1 ? 4 : 2,
          maximumFractionDigits: price < 1 ? 6 : 2
      }).format(price);
  }

  function formatCompact(num) {
      if (!num && num !== 0) return '—';
      if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
      if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
      if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
      if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
      return '$' + num.toFixed(2);
  }

  function formatDate(timestamp, days) {
      const date = new Date(timestamp);
      if (days === 1) {
          return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      }
      if (days <= 7) {
          return date.toLocaleDateString('ru-RU', { weekday: 'short', hour: '2-digit' });
      }
      return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  // ═══════════════════════════════════════════════════════
  //  ОБНОВЛЕНИЕ UI
  // ═══════════════════════════════════════════════════════

  function updatePriceInfo(data) {
      const price = data.market_data?.current_price?.[CONFIG.VS_CURRENCY] ?? 0;
      const change24h = data.market_data?.price_change_percentage_24h ?? 0;
      const volume = data.market_data?.total_volume?.[CONFIG.VS_CURRENCY] ?? 0;
      const marketCap = data.market_data?.market_cap?.[CONFIG.VS_CURRENCY] ?? 0;

      const priceEl = document.getElementById('currentPrice');
      const oldPrice = parseFloat(priceEl.dataset.value || 0);
      priceEl.textContent = formatPrice(price);
      priceEl.dataset.value = price;

      // Анимация изменения цены
      if (oldPrice > 0 && price !== oldPrice) {
          priceEl.style.color = price > oldPrice ? '#3fb950' : '#f85149';
          setTimeout(() => { priceEl.style.color = ''; }, 800);
      }

      const changeEl = document.getElementById('priceChange');
      const changeSign = change24h >= 0 ? '+' : '';
      changeEl.textContent = `${changeSign}${change24h.toFixed(2)}% (24ч)`;
      changeEl.className = 'price-change ' + (change24h >= 0 ? 'positive' : 'negative');

      document.getElementById('statVolume').textContent = formatCompact(volume);
      document.getElementById('statCap').textContent = formatCompact(marketCap);
      document.getElementById('statsRow').style.display = 'grid';
  }

  function updateStats(prices) {
      if (!prices || prices.length === 0) return;
      const values = prices.map(p => p[1]);
      document.getElementById('statHigh').textContent = formatPrice(Math.max(...values));
      document.getElementById('statLow').textContent = formatPrice(Math.min(...values));
  }

  function updateStatus(type, text) {
      const dot = document.getElementById('statusDot');
      const statusText = document.getElementById('statusText');
      const badge = document.getElementById('cacheBadge');

      dot.className = 'status-dot ' + (type === 'offline' ? 'offline' : type === 'cached' ? 'cached' : '');
      statusText.textContent = text;
      badge.style.display = type === 'cached' ? 'inline' : 'none';
  }

  function updateLastUpdateTime() {
      document.getElementById('lastUpdate').textContent = 
          'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');
  }

  // ═══════════════════════════════════════════════════════
  //  ГРАФИК CHART.JS
  // ═══════════════════════════════════════════════════════

  function renderChart(prices, days) {
      const ctx = document.createElement('canvas');
      const container = document.getElementById('chartContainer');
      container.innerHTML = '';
      container.appendChild(ctx);

      const labels = prices.map(p => formatDate(p[0], days));
      const data = prices.map(p => p[1]);

      const isPositive = data[data.length - 1] >= data[0];
      const color = isPositive ? '#3fb950' : '#f85149';
      const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 380);
      gradient.addColorStop(0, isPositive ? 'rgba(63, 185, 80, 0.18)' : 'rgba(248, 81, 73, 0.18)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      if (state.chartInstance) {
          state.chartInstance.destroy();
      }

      state.chartInstance = new Chart(ctx, {
          type: 'line',
          data: {
              labels: labels,
              datasets: [{
                  label: 'BTC Price',
                  data: data,
                  borderColor: color,
                  backgroundColor: gradient,
                  borderWidth: 2.5,
                  pointRadius: 0,
                  pointHoverRadius: 6,
                  pointHoverBackgroundColor: color,
                  pointHoverBorderColor: '#fff',
                  pointHoverBorderWidth: 2,
                  fill: true,
                  tension: 0.4
              }]
          },
          options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: {
                  mode: 'index',
                  intersect: false,
              },
              plugins: {
                  legend: { display: false },
                  tooltip: {
                      backgroundColor: '#161b22',
                      titleColor: '#c9d1d9',
                      bodyColor: '#e6edf3',
                      borderColor: '#30363d',
                      borderWidth: 1,
                      padding: 12,
                      displayColors: false,
                      titleFont: { size: 12 },
                      bodyFont: { size: 14, weight: 'bold' },
                      callbacks: {
                          title: (items) => {
                              const idx = items[0].dataIndex;
                              const ts = prices[idx][0];
                              return new Date(ts).toLocaleString('ru-RU');
                          },
                          label: (ctx) => formatPrice(ctx.parsed.y)
                      }
                  }
              },
              scales: {
                  x: {
                      grid: { display: false, drawBorder: false },
                      ticks: {
                          color: '#484f58',
                          maxTicksLimit: days <= 1 ? 8 : days <= 7 ? 7 : 6,
                          maxRotation: 0,
                          font: { size: 11 }
                      }
                  },
                  y: {
                      grid: {
                          color: '#21262d',
                          drawBorder: false
                      },
                      ticks: {
                          color: '#484f58',
                          font: { size: 11 },
                          callback: (val) => {
                              if (val >= 1e6) return '$' + (val / 1e6).toFixed(1) + 'M';
                              if (val >= 1e3) return '$' + (val / 1e3).toFixed(0) + 'k';
                              return '$' + val;
                          }
                      }
                  }
              },
              animation: {
                  duration: 800,
                  easing: 'easeOutQuart'
              }
          }
      });
  }

  // ═══════════════════════════════════════════════════════
  //  ГЛАВНАЯ ФУНКЦИЯ ЗАГРУЗКИ
  // ═══════════════════════════════════════════════════════

  async function loadWidget(days = 1, forceRefresh = false) {
      if (state.isLoading) return;
      state.isLoading = true;
      state.currentDays = days;

      const container = document.getElementById('chartContainer');
      
      // Показываем загрузку только если нет кэша
      const hasCachedChart = !!getCached(getCacheKey('chart', days));
      const hasCachedMarket = !!getCached(getCacheKey('market'));
      
      if (!hasCachedChart || !hasCachedMarket) {
          container.innerHTML = `
              <div class="loading">
                  <div class="spinner"></div>
                  <div>Загрузка данных...</div>
              </div>
          `;
      }

      try {
          // Параллельная загрузка с разными приоритетами
          const [marketData, chartData] = await Promise.all([
              fetchMarketData(forceRefresh),
              fetchChartData(days, forceRefresh)
          ]);

          updatePriceInfo(marketData);
          updateStats(chartData);
          renderChart(chartData, days);
          updateStatus('online', 'Подключено');
          updateLastUpdateTime();

      } catch (err) {
          console.error('Ошибка загрузки:', err);
          
          // Пробуем показать устаревшие данные из кэша
          const staleMarket = state.cache.get(getCacheKey('market'));
          const staleChart = state.cache.get(getCacheKey('chart', days));
          
          if (staleMarket && staleChart) {
              console.log('⚠️ Показываем устаревшие данные из кэша');
              updatePriceInfo(staleMarket.data);
              updateStats(staleChart.data);
              renderChart(staleChart.data, days);
              updateStatus('cached', 'Данные устарели (офлайн)');
              updateLastUpdateTime();
          } else {
              container.innerHTML = `
                  <div class="error">
                      ⚠️ Не удалось загрузить данные.<br>
                      <small>${err.message}</small><br><br>
                      <button onclick="window.loadWidget(${days}, true)">Повторить</button>
                  </div>
              `;
              updateStatus('offline', 'Ошибка подключения');
          }
      } finally {
          state.isLoading = false;
      }
  }

  // ═══════════════════════════════════════════════════════
  //  АВТООБНОВЛЕНИЕ
  // ═══════════════════════════════════════════════════════

  function startAutoRefresh() {
      if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
      
      state.autoRefreshTimer = setInterval(() => {
          // Проверяем, не истёк ли кэш перед обновлением
          const marketCache = state.cache.get(getCacheKey('market'));
          const chartCache = state.cache.get(getCacheKey('chart', state.currentDays));
          
          const now = Date.now();
          const marketExpired = !marketCache || (now - marketCache.timestamp > marketCache.ttl);
          const chartExpired = !chartCache || (now - chartCache.timestamp > chartCache.ttl);
          
          if (marketExpired || chartExpired) {
              console.log('🔄 Автообновление: кэш устарел');
              loadWidget(state.currentDays, false);
          } else {
              console.log('⏭️ Автообновление: кэш актуален, пропускаем');
          }
      }, CONFIG.AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
      if (state.autoRefreshTimer) {
          clearInterval(state.autoRefreshTimer);
          state.autoRefreshTimer = null;
      }
  }

  // ═══════════════════════════════════════════════════════
  //  ОБРАБОТЧИКИ СОБЫТИЙ
  // ═══════════════════════════════════════════════════════

  document.querySelectorAll('.timeframe-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
          const days = parseInt(btn.dataset.days);
          if (days === state.currentDays && state.chartInstance) return;

          document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          await loadWidget(days, false);
      });
  });

  // Обработка видимости вкладки (пауза автообновления при фоне)
  document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
          console.log('👁️ Вкладка скрыта — пауза автообновления');
          stopAutoRefresh();
      } else {
          console.log('👁️ Вкладка активна — возобновление автообновления');
          startAutoRefresh();
          // Проверяем, не устарели ли данные пока вкладка была скрыта
          loadWidget(state.currentDays, false);
      }
  });

  // ═══════════════════════════════════════════════════════
  //  ЗАПУСК
  // ═══════════════════════════════════════════════════════

  // Делаем loadWidget глобальной для кнопки "Повторить"
  window.loadWidget = loadWidget;

  (async function init() {
      await loadWidget(1);
      startAutoRefresh();
  })();