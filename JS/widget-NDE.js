// ============================================
// NADARAYA-WATSON ENVELOPE PRO
// Плавные сигналы с выбором монеты по клику
// ============================================

class NadarayaWatsonEnvelopePro {
  constructor() {
      // Конфигурация - оптимизирована для плавных сигналов
      this.config = {
          symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
          timeframe: 15,
          // Оптимизированные параметры для плавных сигналов
          bandwidth: 0.45,        // Увеличен для более плавной регрессии
          lookback: 120,          // Больше данных для стабильности
          smoothing: 0.92,        // Выше сглаживание для устранения шума
          threshold: 1.8,         // Немного ниже для чувствительности
          signalSmoothing: 0.7,   // Сглаживание самих сигналов
          minSignalStrength: 15,  // Минимальная сила сигнала
          maxRetries: 5,
          retryDelay: 3000,
      };

      // Состояние
      this.state = {
          prices: {},
          envelopes: {},
          signals: {},
          smoothedSignals: {},    // Сглаженные сигналы
          selectedSymbol: 'BTCUSDT',
          chart: null,
          ws: null,
          isConnected: false,
          reconnectAttempts: 0,
          lastUpdate: null,
          signalHistory: {},      // История сигналов для сглаживания
      };

      // DOM элементы
      this.elements = {
          chart: document.getElementById('chart'),
          coinsGrid: document.getElementById('coinsGrid'),
          currentSignal: document.getElementById('currentSignal'),
          confidenceValue: document.getElementById('confidenceValue'),
          activeCoin: document.getElementById('activeCoin'),
          selectedCoinName: document.getElementById('selectedCoinName'),
          selectedCoinPrice: document.getElementById('selectedCoinPrice'),
          selectedCoinIcon: document.getElementById('selectedCoinIcon'),
          entrySignal: document.getElementById('entrySignal'),
          entryConfidence: document.getElementById('entryConfidence'),
          entryTimeframe: document.getElementById('entryTimeframe'),
          entryLastUpdate: document.getElementById('entryLastUpdate'),
          statusDot: document.getElementById('statusDot'),
          connectionStatus: document.getElementById('connectionStatus'),
          errorMessage: document.getElementById('errorMessage'),
          timeframeBtns: document.querySelectorAll('.timeframe-btn'),
      };

      // Иконки для монет
      this.coinIcons = {
          'BTCUSDT': '₿',
          'ETHUSDT': '⟠',
          'SOLUSDT': '◎',
          'XRPUSDT': '✕',
          'ADAUSDT': '₳',
          'DOGEUSDT': 'Ð'
      };

      this.init();
  }

  init() {
      this.setupEventListeners();
      this.initializeChart();
      this.connectWebSocket();
      this.startPolling();
      this.renderCoins();
      this.selectCoin('BTCUSDT');
  }

  // ============================================
  // WEBSOCKET CONNECTION
  // ============================================

  connectWebSocket() {
      try {
          const streams = this.config.symbols
              .map(s => `${s.toLowerCase()}@trade`)
              .join('/');

          this.state.ws = new WebSocket(
              `wss://stream.binance.com:9443/stream?streams=${streams}`
          );

          this.state.ws.onopen = () => this.onWsOpen();
          this.state.ws.onmessage = (event) => this.onWsMessage(event);
          this.state.ws.onerror = (error) => this.onWsError(error);
          this.state.ws.onclose = () => this.onWsClose();

      } catch (error) {
          console.error('WebSocket connection error:', error);
          this.showError('Ошибка подключения к WebSocket');
      }
  }

  onWsOpen() {
      this.state.isConnected = true;
      this.state.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
      this.showError(null);
      console.log('WebSocket connected');
  }

  onWsMessage(event) {
      try {
          const data = JSON.parse(event.data);
          if (data.data) {
              const symbol = data.data.s;
              const price = parseFloat(data.data.p);
              
              if (!this.state.prices[symbol]) {
                  this.state.prices[symbol] = [];
              }
              
              this.state.prices[symbol].push(price);
              
              const maxHistory = this.config.lookback * 2;
              if (this.state.prices[symbol].length > maxHistory) {
                  this.state.prices[symbol] = this.state.prices[symbol].slice(-maxHistory);
              }

              // Обновляем только если данные накопились
              if (this.state.prices[symbol].length >= 30) {
                  this.updateEnvelope(symbol);
                  this.updateSignals();
                  this.updateChart();
                  this.updateUI();
              }
          }
      } catch (error) {
          console.error('Error processing WebSocket message:', error);
      }
  }

  onWsError(error) {
      console.error('WebSocket error:', error);
      this.showError('Ошибка соединения. Попытка переподключения...');
  }

  onWsClose() {
      this.state.isConnected = false;
      this.updateConnectionStatus(false);
      this.reconnectWebSocket();
  }

  reconnectWebSocket() {
      if (this.state.reconnectAttempts < this.config.maxRetries) {
          this.state.reconnectAttempts++;
          console.log(`Reconnecting... Attempt ${this.state.reconnectAttempts}`);
          setTimeout(() => this.connectWebSocket(), this.config.retryDelay);
      } else {
          this.showError('Не удалось подключиться к WebSocket. Используется режим опроса.');
          this.startPolling();
      }
  }

  // ============================================
  // POLLING FALLBACK
  // ============================================

  startPolling() {
      if (this.pollingInterval) clearInterval(this.pollingInterval);
      this.pollingInterval = setInterval(() => {
          if (!this.state.isConnected) {
              this.fetchPrices();
          }
      }, 5000);
  }

  async fetchPrices() {
      try {
          const symbols = this.config.symbols.map(s => `"${s}"`).join(',');
          const response = await fetch(
              `https://api.binance.com/api/v3/ticker/price?symbols=[${symbols}]`
          );
          const data = await response.json();
          
          data.forEach(item => {
              const symbol = item.symbol;
              const price = parseFloat(item.price);
              
              if (!this.state.prices[symbol]) {
                  this.state.prices[symbol] = [];
              }
              
              this.state.prices[symbol].push(price);
              
              if (this.state.prices[symbol].length > this.config.lookback * 2) {
                  this.state.prices[symbol] = this.state.prices[symbol].slice(-this.config.lookback * 2);
              }
          });

          this.updateAllIndicators();
      } catch (error) {
          console.error('Error fetching prices:', error);
      }
  }

  // ============================================
  // NADARAYA-WATSON ENVELOPE CALCULATIONS
  // ============================================

  calculateNWEnvelope(prices) {
      if (!prices || prices.length < 30) return null;

      const n = prices.length;
      const bandwidth = this.config.bandwidth;
      const smoothing = this.config.smoothing;
      
      // Ядро Epanechnikov с оптимизацией
      const kernel = (x) => {
          const absX = Math.abs(x);
          if (absX > 1) return 0;
          return 0.75 * (1 - absX * absX);
      };

      const x = Array.from({ length: n }, (_, i) => i / n);
      const y = prices;

      const smoothed = [];
      const upperBand = [];
      const lowerBand = [];

      // Оптимизация: используем скользящее окно для вычислений
      const windowSize = Math.floor(n * bandwidth);
      
      for (let i = 0; i < n; i++) {
          let sumKernel = 0;
          let sumWeighted = 0;
          let sumWeightedSq = 0;
          
          const start = Math.max(0, i - windowSize);
          const end = Math.min(n, i + windowSize);

          for (let j = start; j < end; j++) {
              const diff = (i - j) / (n * bandwidth);
              const k = kernel(diff);
              sumKernel += k;
              sumWeighted += k * y[j];
              sumWeightedSq += k * y[j] * y[j];
          }

          const mean = sumKernel > 0.001 ? sumWeighted / sumKernel : y[i];
          const variance = sumKernel > 0.001 ? 
              Math.max(0, sumWeightedSq / sumKernel - mean * mean) : 0;
          const stdDev = Math.sqrt(variance);

          // Экспоненциальное сглаживание
          const smoothMean = i === 0 ? mean : 
              smoothing * mean + (1 - smoothing) * smoothed[i - 1];

          smoothed.push(smoothMean);
          
          // Полосы с адаптивным порогом
          const threshold = this.config.threshold * (stdDev + 0.01);
          upperBand.push(smoothMean + threshold);
          lowerBand.push(smoothMean - threshold);
      }

      return {
          smoothed,
          upperBand,
          lowerBand,
          current: {
              price: prices[n - 1],
              mean: smoothed[n - 1],
              upper: upperBand[n - 1],
              lower: lowerBand[n - 1],
              deviation: (prices[n - 1] - smoothed[n - 1]) / (upperBand[n - 1] - smoothed[n - 1] + 0.001)
          }
      };
  }

  // ============================================
  // SIGNAL GENERATION - ПЛАВНЫЕ СИГНАЛЫ
  // ============================================

  generateSignal(price, mean, upper, lower) {
      const range = upper - mean;
      const deviation = range > 0.001 ? (price - mean) / range : 0;
      
      // Ограничиваем отклонение
      const clampedDeviation = Math.max(-1, Math.min(1, deviation));
      
      // Плавная сигмоида для определения силы сигнала
      const sigmoid = (x) => 1 / (1 + Math.exp(-x * 4));
      
      // Вычисляем силу сигнала (0-100)
      let strength = 0;
      let direction = 'NEUTRAL';
      let confidence = 0;
      
      if (clampedDeviation > 0.3) {
          // Сигнал на продажу
          strength = Math.round((clampedDeviation - 0.3) / 0.7 * 100);
          direction = 'SELL';
          confidence = Math.round(sigmoid((clampedDeviation - 0.3) * 3) * 100);
      } else if (clampedDeviation < -0.3) {
          // Сигнал на покупку
          strength = Math.round((-clampedDeviation - 0.3) / 0.7 * 100);
          direction = 'BUY';
          confidence = Math.round(sigmoid((-clampedDeviation - 0.3) * 3) * 100);
      } else {
          // Нейтрально
          strength = 0;
          direction = 'NEUTRAL';
          confidence = Math.round((1 - Math.abs(clampedDeviation) / 0.3) * 40);
      }
      
      // Применяем минимальный порог
      if (strength < this.config.minSignalStrength && direction !== 'NEUTRAL') {
          direction = 'NEUTRAL';
          strength = 0;
          confidence = Math.round(confidence * 0.3);
      }
      
      return {
          direction,
          strength,
          confidence: Math.min(100, confidence),
          deviation: clampedDeviation,
          price,
          mean,
          upper,
          lower
      };
  }

  // Сглаживание сигналов во времени
  smoothSignal(symbol, newSignal) {
      if (!this.state.signalHistory[symbol]) {
          this.state.signalHistory[symbol] = [];
      }
      
      const history = this.state.signalHistory[symbol];
      history.push(newSignal);
      
      // Храним историю для сглаживания
      if (history.length > 20) {
          history.shift();
      }
      
      // Вычисляем сглаженный сигнал
      if (history.length < 3) {
          return newSignal;
      }
      
      const recentSignals = history.slice(-10);
      const buyCount = recentSignals.filter(s => s.direction === 'BUY').length;
      const sellCount = recentSignals.filter(s => s.direction === 'SELL').length;
      
      let smoothedDirection = 'NEUTRAL';
      let smoothedConfidence = 0;
      
      // Определяем направление по большинству
      if (buyCount > sellCount + 2) {
          smoothedDirection = 'BUY';
          smoothedConfidence = Math.min(100, Math.round((buyCount / recentSignals.length) * 100));
      } else if (sellCount > buyCount + 2) {
          smoothedDirection = 'SELL';
          smoothedConfidence = Math.min(100, Math.round((sellCount / recentSignals.length) * 100));
      } else {
          smoothedDirection = 'NEUTRAL';
          smoothedConfidence = Math.round((1 - Math.abs(buyCount - sellCount) / recentSignals.length) * 30);
      }
      
      // Усредняем силу сигнала
      const avgStrength = recentSignals.reduce((sum, s) => sum + s.strength, 0) / recentSignals.length;
      
      return {
          ...newSignal,
          direction: smoothedDirection,
          confidence: smoothedConfidence,
          strength: Math.round(avgStrength)
      };
  }

  updateEnvelope(symbol) {
      const prices = this.state.prices[symbol];
      if (!prices || prices.length < 30) return;

      const result = this.calculateNWEnvelope(prices);
      if (result) {
          this.state.envelopes[symbol] = result;
          
          // Генерируем сырой сигнал
          const rawSignal = this.generateSignal(
              result.current.price,
              result.current.mean,
              result.current.upper,
              result.current.lower
          );
          
          // Применяем сглаживание
          const smoothedSignal = this.smoothSignal(symbol, rawSignal);
          this.state.signals[symbol] = smoothedSignal;
      }
  }

  updateAllIndicators() {
      this.config.symbols.forEach(symbol => {
          this.updateEnvelope(symbol);
      });
      this.updateSignals();
      this.updateChart();
      this.updateUI();
  }

  updateSignals() {
      // Находим самый сильный сигнал
      let strongest = { direction: 'NEUTRAL', confidence: 0, symbol: '' };
      
      for (const [symbol, signal] of Object.entries(this.state.signals)) {
          if (signal.confidence > strongest.confidence && signal.direction !== 'NEUTRAL') {
              strongest = { ...signal, symbol };
          }
      }
      
      this.state.strongestSignal = strongest;
  }

  // ============================================
  // SELECT COIN
  // ============================================

  selectCoin(symbol) {
      this.state.selectedSymbol = symbol;
      
      // Обновляем UI
      const displayName = symbol.replace('USDT', '');
      this.elements.selectedCoinName.textContent = displayName;
      this.elements.selectedCoinIcon.textContent = this.coinIcons[symbol] || '₿';
      this.elements.activeCoin.textContent = displayName;
      
      // Обновляем цену
      const price = this.state.prices[symbol]?.slice(-1)[0] || 0;
      this.elements.selectedCoinPrice.textContent = `$${price.toFixed(2)}`;
      
      // Обновляем активные карточки
      document.querySelectorAll('.coin-card').forEach(card => {
          card.classList.toggle('active', card.dataset.symbol === symbol);
      });
      
      // Обновляем сигнал входа
      this.updateEntrySignal();
      
      // Обновляем график
      this.updateChart();
  }

  // ============================================
  // ENTRY SIGNAL UPDATE
  // ============================================

  updateEntrySignal() {
      const symbol = this.state.selectedSymbol;
      const signal = this.state.signals[symbol];
      
      if (!signal) {
          this.elements.entrySignal.textContent = 'Загрузка данных...';
          this.elements.entrySignal.className = 'signal-main neutral';
          return;
      }
      
      const signalText = signal.direction === 'BUY' ? '📈 ПОКУПКА' :
                        signal.direction === 'SELL' ? '📉 ПРОДАЖА' : '⏸️ Нейтрально';
      
      this.elements.entrySignal.textContent = signalText;
      this.elements.entrySignal.className = `signal-main ${signal.direction.toLowerCase()}`;
      
      this.elements.entryConfidence.textContent = `${signal.confidence}%`;
      this.elements.entryTimeframe.textContent = `${this.config.timeframe} мин`;
      this.elements.entryLastUpdate.textContent = new Date().toLocaleTimeString();
      
      // Обновляем общий сигнал
      this.elements.currentSignal.textContent = signalText;
      this.elements.currentSignal.className = `value ${signal.direction.toLowerCase()}`;
      this.elements.confidenceValue.textContent = `${signal.confidence}%`;
  }

  // ============================================
  // CHART RENDERING
  // ============================================

  initializeChart() {
      const ctx = this.elements.chart.getContext('2d');
      
      this.state.chart = new Chart(ctx, {
          type: 'line',
          data: {
              labels: [],
              datasets: [
                  {
                      label: 'Цена',
                      data: [],
                      borderColor: '#60a5fa',
                      borderWidth: 2,
                      pointRadius: 0,
                      tension: 0.1,
                  },
                  {
                      label: 'NW Сглаженная',
                      data: [],
                      borderColor: '#7b2ffc',
                      borderWidth: 2,
                      borderDash: [5, 5],
                      pointRadius: 0,
                      tension: 0.1,
                  },
                  {
                      label: 'Верхняя полоса',
                      data: [],
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      borderWidth: 1,
                      fill: '+1',
                      pointRadius: 0,
                      tension: 0.1,
                      backgroundColor: 'rgba(239, 68, 68, 0.05)',
                  },
                  {
                      label: 'Нижняя полоса',
                      data: [],
                      borderColor: 'rgba(74, 222, 128, 0.4)',
                      borderWidth: 1,
                      fill: false,
                      pointRadius: 0,
                      tension: 0.1,
                  }
              ]
          },
          options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                  legend: {
                      labels: {
                          color: '#8892b0',
                          font: { size: 11 },
                      },
                  },
              },
              scales: {
                  x: {
                      grid: { color: 'rgba(255,255,255,0.03)' },
                      ticks: { color: '#8892b0', font: { size: 10 }, maxTicksLimit: 15 },
                  },
                  y: {
                      grid: { color: 'rgba(255,255,255,0.03)' },
                      ticks: { color: '#8892b0', font: { size: 10 } },
                  },
              },
              interaction: {
                  intersect: false,
                  mode: 'index',
              },
          },
      });
  }

  updateChart() {
      if (!this.state.chart) return;

      const symbol = this.state.selectedSymbol;
      const envelope = this.state.envelopes[symbol];
      const prices = this.state.prices[symbol];
      
      if (!envelope || !prices) return;

      const data = envelope.smoothed;
      const displayCount = Math.min(60, data.length);
      const startIdx = data.length - displayCount;
      
      const labels = Array.from({ length: displayCount }, (_, i) => {
          const idx = startIdx + i;
          return new Date(Date.now() - (data.length - idx) * 60000).toLocaleTimeString();
      });

      this.state.chart.data.labels = labels;
      this.state.chart.data.datasets[0].data = prices.slice(-displayCount);
      this.state.chart.data.datasets[1].data = data.slice(-displayCount);
      this.state.chart.data.datasets[2].data = envelope.upperBand.slice(-displayCount);
      this.state.chart.data.datasets[3].data = envelope.lowerBand.slice(-displayCount);

      this.state.chart.update('none');
  }

  // ============================================
  //