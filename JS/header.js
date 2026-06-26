
const PAIRS = [
  { symbol: 'BTC', name: 'BIT' },   // BIT → BTC
  { symbol: 'ETH', name: 'ETH' },
  { symbol: 'SOL', name: 'SOL' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'ADA', name: 'ADA'},
  { symbol: 'DOGE', name: 'DOGE'}
];

const nav = document.getElementById('tickerNav');
const statusEl = document.getElementById('status');
const prices = {};

// Генерация DOM
PAIRS.forEach(({ symbol, name }) => {
  const label = document.createElement('p');
  label.textContent = `${name}:`;
  
  const value = document.createElement('span');
  value.id = `${symbol.toLowerCase()}Price`;
  value.className = 'loading';
  value.textContent = '—';
  
  nav.append(label, value);
  prices[symbol] = { el: value, last: null };
});

// WebSocket
const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');

ws.onopen = () => {
  statusEl.textContent = '● Live';
  statusEl.className = 'status connected';
  ws.send(JSON.stringify({
    op: 'subscribe',
    args: PAIRS.map(p => `tickers.${p.symbol}USDT`)
  }));
};

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.topic?.startsWith('tickers.')) {
      const symbol = msg.topic.replace('tickers.', '').replace('USDT', '');
      const price = msg.data?.lastPrice;
      if (!price || !prices[symbol]) return;

      const item = prices[symbol];
      const numPrice = parseFloat(price);
      
      // Цветовая индикация изменения
      item.el.className = item.last !== null
        ? (numPrice > item.last ? 'up' : numPrice < item.last ? 'down' : '')
        : '';
      
      item.el.textContent = `$${parseFloat(price).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: price < 1 ? 4 : 2
      })}`;
      item.last = numPrice;
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
};

ws.onerror = () => {
  statusEl.textContent = '● Error';
  statusEl.className = 'status error';
};

ws.onclose = () => {
  statusEl.textContent = '● Reconnecting...';
  statusEl.className = 'status error';
  setTimeout(() => location.reload(), 3000);
};