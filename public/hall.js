// Общие функции: отрисовка схемы зала, подсказки и запросы к API.
const SVG_NS = 'http://www.w3.org/2000/svg';
const STATE_LABEL = { free: 'Свободен', booked: 'Забронирован', seated: 'Гости за столом' };
const STATE_COLOR = { free: 'var(--free-2)', booked: 'var(--booked)', seated: 'var(--seated)' };

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// Стулья вокруг стола.
function drawChairs(g, t) {
  const n = t.seats;
  if (t.shape === 'round') {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      const d = t.r + 11;
      const cx = t.x + Math.cos(a) * d;
      const cy = t.y + Math.sin(a) * d;
      const deg = (a * 180) / Math.PI + 90;
      el('rect', { class: 'chair', x: cx - 9, y: cy - 6, width: 18, height: 12, rx: 5, transform: `rotate(${deg} ${cx} ${cy})` }, g);
    }
  } else {
    const perSide = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const top = i < perSide;
      const count = top ? perSide : n - perSide;
      const idx = top ? i : i - perSide;
      const cx = t.x - t.w / 2 + (t.w / (count + 1)) * (idx + 1);
      const cy = top ? t.y - t.h / 2 - 11 : t.y + t.h / 2 + 11;
      el('rect', { class: 'chair', x: cx - 10, y: cy - 6, width: 20, height: 12, rx: 5 }, g);
    }
  }
}

function drawDefs(svg) {
  const defs = el('defs', {}, svg);
  const p = el('pattern', { id: 'dots', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }, defs);
  el('circle', { class: 'floor-dot', cx: 2, cy: 2, r: 1.3 }, p);
  const f = el('filter', { id: 'tshadow', x: '-30%', y: '-30%', width: '160%', height: '170%' }, defs);
  el('feDropShadow', { dx: 0, dy: 3, stdDeviation: 3.5, 'flood-color': '#2a1d05', 'flood-opacity': 0.18 }, f);
}

function drawDecor(svg, d) {
  const g = el('g', { class: `decor ${d.type}` }, svg);
  el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, rx: d.type === 'zone' ? 18 : d.type === 'bar' ? 12 : 3 }, g);
  if (!d.label) return;
  const vertical = d.h > d.w * 2;
  let attrs;
  if (d.type === 'zone') attrs = { x: d.x + 16, y: d.y + d.h - 14 };
  else if (d.type === 'bar') attrs = { x: d.x + d.w / 2, y: d.y + d.h / 2 + 4, 'text-anchor': 'middle' };
  else if (vertical) attrs = { x: d.x + (d.x < 400 ? 22 : -10), y: d.y + d.h / 2, 'text-anchor': d.x < 400 ? 'start' : 'end' };
  else attrs = { x: d.x + d.w / 2, y: d.y < 260 ? d.y + d.h + 18 : d.y - 10, 'text-anchor': 'middle' };
  const t = el('text', attrs, g);
  t.textContent = d.label;
}

/**
 * Рисует зал в контейнере.
 * opts.states   — [{id, state, bookedFrom}]
 * opts.selected — id выбранного стола
 * opts.isDisabled(t, state) — стол нельзя выбрать (полупрозрачный)
 * opts.isLocked(t, state)   — стол нельзя кликнуть, цвет обычный
 * opts.onSelect(t, state)
 * opts.tipExtra(t, state)   — доп. строка в подсказке
 */
function renderHall(container, restaurant, opts = {}) {
  const stateById = Object.fromEntries((opts.states || []).map((s) => [s.id, s]));
  container.innerHTML = '';
  container.classList.add('hall');
  const svg = el('svg', { viewBox: '-14 -14 828 548', role: 'img', 'aria-label': `Схема зала ${restaurant.name}` });
  container.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  container.appendChild(tip);

  drawDefs(svg);
  el('rect', { class: 'floor', x: 0, y: 0, width: 800, height: 520, rx: 16 }, svg);
  el('rect', { class: 'floor-dots', x: 0, y: 0, width: 800, height: 520, rx: 16 }, svg);
  el('rect', { class: 'wall', x: 0, y: 0, width: 800, height: 520, rx: 16 }, svg);
  // окна и вход «прорезают» стену, поэтому рисуются поверх
  for (const d of restaurant.decor) drawDecor(svg, d);

  for (const t of restaurant.tables) {
    const s = stateById[t.id] || { state: 'free' };
    const disabled = opts.isDisabled ? opts.isDisabled(t, s) : false;
    const locked = opts.isLocked ? opts.isLocked(t, s) : false;
    const selected = opts.selected === t.id;
    const cls = ['table-el', s.state];
    if (disabled) cls.push('disabled');
    if (locked) cls.push('locked');
    if (selected) cls.push('selected');

    const interactive = !disabled && !locked && opts.onSelect;
    const g = el('g', {
      class: cls.join(' '),
      tabindex: interactive ? 0 : -1,
      role: 'button',
      'aria-label': `Стол ${t.id}, ${t.seats} мест, ${STATE_LABEL[s.state]}`,
    }, svg);

    drawChairs(g, t);
    if (t.shape === 'round') {
      el('circle', { class: 'ring', cx: t.x, cy: t.y, r: t.r + 6 }, g);
      el('circle', { class: 'shape', cx: t.x, cy: t.y, r: t.r }, g);
    } else {
      el('rect', { class: 'ring', x: t.x - t.w / 2 - 6, y: t.y - t.h / 2 - 6, width: t.w + 12, height: t.h + 12, rx: 16 }, g);
      el('rect', { class: 'shape', x: t.x - t.w / 2, y: t.y - t.h / 2, width: t.w, height: t.h, rx: 12 }, g);
    }
    const small = t.r && t.r < 30;
    const label = el('text', { class: 'tid', x: t.x, y: t.y + (small ? 5 : -1), 'text-anchor': 'middle' }, g);
    label.textContent = t.id;
    if (!small) {
      const seats = el('text', { class: 'seats', x: t.x, y: t.y + 15, 'text-anchor': 'middle' }, g);
      seats.textContent = `${t.seats} ${plural(t.seats, 'место', 'места', 'мест')}`;
    }

    // подсказка при наведении
    g.addEventListener('mouseenter', () => {
      const box = svg.getBoundingClientRect();
      const k = box.width / 828;
      const top = t.shape === 'round' ? t.y - t.r - 14 : t.y - t.h / 2 - 18;
      tip.style.left = `${(t.x + 14) * k}px`;
      tip.style.top = `${(top + 14) * k}px`;
      let html = `<b>Стол ${t.id}</b> · ${t.seats} ${plural(t.seats, 'место', 'места', 'мест')} · ${t.zone}<br>
        <span class="st"><i style="background:${STATE_COLOR[s.state]}"></i>${STATE_LABEL[s.state]}${
          s.state !== 'free' && s.bookedFrom ? ` с ${s.bookedFrom}` : ''}</span>`;
      const extra = opts.tipExtra && opts.tipExtra(t, s);
      if (extra) html += `<br><span class="st">${extra}</span>`;
      tip.innerHTML = html;
      tip.classList.add('show');
    });
    g.addEventListener('mouseleave', () => tip.classList.remove('show'));

    if (interactive) {
      const pick = () => opts.onSelect(t, s);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    }
  }
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

// Подписка на живые обновления от сервера.
function onLiveUpdate(cb) {
  if (location.search.includes('nolive')) return null; // для скриншотов/тестов
  const es = new EventSource('/api/events');
  es.onmessage = (e) => cb(JSON.parse(e.data));
  return es;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function formatDate(s) {
  if (s === todayStr()) return 'Сегодня';
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (s === todayStr(tm)) return 'Завтра';
  return parseDate(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
