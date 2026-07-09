const API_URL = 'https://api.alternative.me/fng/?limit=31&format=json';

// Цвета для диапазонов
const COLORS = {
  extremeFear: '#ef4444',
  fear: '#f97316',
  neutral: '#eab308',
  greed: '#84cc16',
  extremeGreed: '#22c55e'
};

function getColor(value) {
  if (value <= 20) return COLORS.extremeFear;
  if (value <= 40) return COLORS.fear;
  if (value <= 60) return COLORS.neutral;
  if (value <= 80) return COLORS.greed;
  return COLORS.extremeGreed;
}

function getLabel(value) {
  if (value <= 20) return { text: 'Extreme Fear', class: 'extreme-fear' };
  if (value <= 40) return { text: 'Fear', class: 'fear' };
  if (value <= 60) return { text: 'Neutral', class: 'neutral' };
  if (value <= 80) return { text: 'Greed', class: 'greed' };
  return { text: 'Extreme Greed', class: 'extreme-greed' };
}

function getClassificationClass(value) {
  if (value <= 20) return 'extreme-fear';
  if (value <= 40) return 'fear';
  if (value <= 60) return 'neutral';
  if (value <= 80) return 'greed';
  return 'extreme-greed';
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

function animateValue(element, start, end, duration) {
  const startTime = performance.now();
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(start + (end - start) * ease);
    element.textContent = current;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

async function fetchData() {
  const loadingEl = document.getElementById('loadingState');
  const contentEl = document.getElementById('contentState');
  const errorEl = document.getElementById('errorState');

  loadingEl.style.display = 'flex';
  contentEl.style.display = 'none';
  errorEl.style.display = 'none';

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('Network error');
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) throw new Error('No data');

    const current = data.data[0];
    const yesterday = data.data[1];
    const weekAgo = data.data[6] || data.data[data.data.length - 1];
    const monthAgo = data.data[data.data.length - 1];

    const value = parseInt(current.value);
    const label = getLabel(value);

    // Обновляем UI
    document.getElementById('gaugeValue').textContent = value;
    document.getElementById('gaugeLabel').textContent = label.text;
    document.getElementById('gaugeLabel').className = 'gauge-label ' + label.class;

    // Анимация стрелки
    // 0 = -90deg (крайняя левая), 100 = 90deg (крайняя правая)
    const angle = -90 + (value / 100) * 180;
    document.getElementById('gaugeNeedle').style.transform = `rotate(${angle}deg)`;

    // Анимация дуги
    const maxArc = 314; // длина полуокружности радиуса 100
    const fillArc = (value / 100) * maxArc;
    const gaugeFill = document.getElementById('gaugeFill');
    gaugeFill.style.stroke = getColor(value);
    gaugeFill.style.strokeDashoffset = maxArc - fillArc;

    // Статистика
    document.getElementById('yesterdayVal').textContent = yesterday ? yesterday.value : '--';
    document.getElementById('weekVal').textContent = weekAgo ? weekAgo.value : '--';
    document.getElementById('monthVal').textContent = monthAgo ? monthAgo.value : '--';

    // Таймер обновления
    if (current.time_until_update) {
      let remaining = parseInt(current.time_until_update);
      const updateEl = document.getElementById('nextUpdate');
      updateEl.textContent = formatTime(remaining);
      
      // Обновляем таймер каждую секунду
      if (window.updateTimer) clearInterval(window.updateTimer);
      window.updateTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(window.updateTimer);
          fetchData();
        } else {
          updateEl.textContent = formatTime(remaining);
        }
      }, 1000);
    }

    // Показываем контент
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    contentEl.classList.add('fade-in');

  } catch (err) {
    console.error('Error:', err);
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
  }
}

// Запускаем при загрузке
fetchData();

// Автообновление каждые 30 минут
setInterval(fetchData, 30 * 60 * 1000);