// Общие функции: отрисовка схемы зала, подсказки и запросы к API.
import type { Decor, LiveMessage, Restaurant, Table, TableState, TableStatus } from '../shared/types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const STATE_LABEL: Record<TableState, string> = { free: 'Свободен', booked: 'Забронирован', seated: 'Гости за столом' };
const STATE_COLOR: Record<TableState, string> = { free: 'var(--free-2)', booked: 'var(--booked)', seated: 'var(--seated)' };

type Attrs = Record<string, string | number>;

function el(name: string, attrs: Attrs = {}, parent?: Element): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

// Стулья вокруг стола.
function drawChairs(g: Element, t: Table): void {
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

function drawDefs(svg: Element): void {
  const defs = el('defs', {}, svg);
  const p = el('pattern', { id: 'dots', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }, defs);
  el('circle', { class: 'floor-dot', cx: 2, cy: 2, r: 1.3 }, p);
  const f = el('filter', { id: 'tshadow', x: '-30%', y: '-30%', width: '160%', height: '170%' }, defs);
  el('feDropShadow', { dx: 0, dy: 3, stdDeviation: 3.5, 'flood-color': '#2a1d05', 'flood-opacity': 0.18 }, f);
}

function drawDecor(svg: Element, d: Decor): void {
  const g = el('g', { class: `decor ${d.type}` }, svg);
  el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, rx: d.type === 'zone' ? 18 : d.type === 'bar' ? 12 : 3 }, g);
  if (!d.label) return;
  const vertical = d.h > d.w * 2;
  let attrs: Attrs;
  if (d.type === 'zone') attrs = { x: d.x + 16, y: d.y + d.h - 14 };
  else if (d.type === 'bar') attrs = { x: d.x + d.w / 2, y: d.y + d.h / 2 + 4, 'text-anchor': 'middle' };
  else if (vertical) attrs = { x: d.x + (d.x < 400 ? 22 : -10), y: d.y + d.h / 2, 'text-anchor': d.x < 400 ? 'start' : 'end' };
  else attrs = { x: d.x + d.w / 2, y: d.y < 260 ? d.y + d.h + 18 : d.y - 10, 'text-anchor': 'middle' };
  const t = el('text', attrs, g);
  t.textContent = d.label;
}

export interface HallOptions {
  states?: TableStatus[];
  selected?: string | null;
  /** стол нельзя выбрать (полупрозрачный) */
  isDisabled?: (t: Table, s: TableStatus) => boolean;
  /** стол нельзя кликнуть, цвет обычный */
  isLocked?: (t: Table, s: TableStatus) => boolean;
  onSelect?: (t: Table, s: TableStatus) => void;
  /** доп. строка в подсказке */
  tipExtra?: (t: Table, s: TableStatus) => string;
}

/** Рисует зал в контейнере. */
export function renderHall(container: HTMLElement, restaurant: Restaurant, opts: HallOptions = {}): void {
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
    const s: TableStatus = stateById[t.id] || { id: t.id, state: 'free', bookingId: null, bookedFrom: null };
    const disabled = opts.isDisabled ? opts.isDisabled(t, s) : false;
    const locked = opts.isLocked ? opts.isLocked(t, s) : false;
    const selected = opts.selected === t.id;
    const cls = ['table-el', s.state];
    if (disabled) cls.push('disabled');
    if (locked) cls.push('locked');
    if (selected) cls.push('selected');

    const onSelect = !disabled && !locked ? opts.onSelect : undefined;
    const g = el('g', {
      class: cls.join(' '),
      tabindex: onSelect ? 0 : -1,
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
    const small = t.shape === 'round' && t.r < 30;
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
      let stExtra = '';
      if (s.state === 'seated') {
        const ms = parseSeatedMs(s.seatedAt, undefined, s.bookedFrom ?? undefined);
        if (ms) {
          const stats = getSeatingStats(ms);
          stExtra = ` · сели в ${stats.seatedTimeStr} (${stats.elapsedFormatted})`;
        } else if (s.bookedFrom) {
          stExtra = ` с ${s.bookedFrom}`;
        }
      } else if (s.state !== 'free' && s.bookedFrom) {
        stExtra = ` с ${s.bookedFrom}`;
      }
      let html = `<b>Стол ${t.id}</b> · ${t.seats} ${plural(t.seats, 'место', 'места', 'мест')} · ${t.zone}<br>
        <span class="st"><i style="background:${STATE_COLOR[s.state]}"></i>${STATE_LABEL[s.state]}${stExtra}</span>`;
      const extra = opts.tipExtra && opts.tipExtra(t, s);
      if (extra) html += `<br><span class="st">${extra}</span>`;
      tip.innerHTML = html;
      tip.classList.add('show');
    });
    g.addEventListener('mouseleave', () => tip.classList.remove('show'));

    if (onSelect) {
      const pick = () => onSelect(t, s);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') { e.preventDefault(); pick(); }
      });
    }
  }
}

export function parseSeatedMs(seatedAt: string | undefined | null, bookingDate?: string, bookingTime?: string): number | null {
  if (!seatedAt && !bookingTime) return null;
  if (seatedAt && seatedAt.includes('T')) {
    const ms = new Date(seatedAt).getTime();
    if (!isNaN(ms)) return ms;
  }
  const timePart = seatedAt && /^\d{2}:\d{2}$/.test(seatedAt) ? seatedAt : bookingTime;
  if (!timePart) return null;
  const dPart = bookingDate || todayStr();
  const ms = new Date(`${dPart}T${timePart}:00`).getTime();
  return isNaN(ms) ? null : ms;
}

export function getSeatingStats(seatedMs: number): {
  seatedTimeStr: string;
  elapsedMinutes: number;
  elapsedFormatted: string;
  timerDigits: string;
  progressPct: number;
  isOverLimit: boolean;
  isWarning: boolean;
  remainingText: string;
} {
  const diffMs = Math.max(0, Date.now() - seatedMs);
  const totalSec = Math.floor(diffMs / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const secs = totalSec % 60;

  const seatedDate = new Date(seatedMs);
  const seatedTimeStr = `${pad(seatedDate.getHours())}:${pad(seatedDate.getMinutes())}`;

  let elapsedFormatted = '';
  if (hours > 0) {
    elapsedFormatted = `${hours} ч ${mins} мин`;
  } else {
    elapsedFormatted = `${mins} мин`;
  }

  const timerDigits = hours > 0
    ? `${pad(hours)}:${pad(mins)}:${pad(secs)}`
    : `${pad(mins)}:${pad(secs)}`;

  const limitMinutes = 120;
  const progressPct = Math.min(100, Math.round((totalMin / limitMinutes) * 100));
  const isOverLimit = totalMin >= limitMinutes;
  const isWarning = totalMin >= 90 && !isOverLimit;

  let remainingText = '';
  if (isOverLimit) {
    const overMin = totalMin - limitMinutes;
    remainingText = `Превышение на ${overMin >= 60 ? `${Math.floor(overMin / 60)} ч ${overMin % 60} мин` : `${overMin} мин`}`;
  } else {
    const remMin = limitMinutes - totalMin;
    remainingText = `Осталось ~${remMin >= 60 ? `${Math.floor(remMin / 60)} ч ${remMin % 60} мин` : `${remMin} мин`}`;
  }

  return {
    seatedTimeStr,
    elapsedMinutes: totalMin,
    elapsedFormatted,
    timerDigits,
    progressPct,
    isOverLimit,
    isWarning,
    remainingText,
  };
}

export async function api<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: options.method,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // вход в панель истёк или его не было — на страницу входа
  if (res.status === 401 && location.pathname.startsWith('/admin')) {
    location.href = '/login';
    return new Promise<T>(() => {}); // страница уходит, дальше не продолжаем
  }
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data as T;
}

// Подписка на живые обновления от сервера.
export function onLiveUpdate(cb: (msg: LiveMessage) => void): EventSource | null {
  if (location.search.includes('nolive')) return null; // для скриншотов/тестов
  const es = new EventSource('/api/events');
  es.onmessage = (e) => cb(JSON.parse(e.data) as LiveMessage);
  return es;
}

/** Достаёт элемент по id; падает, если его нет в разметке. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Нет элемента #${id}`);
  return node as T;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
export function pad(n: number): string { return String(n).padStart(2, '0'); }
export function todayStr(d = new Date()): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDate(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function formatDate(s: string): string {
  if (s === todayStr()) return 'Сегодня';
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (s === todayStr(tm)) return 'Завтра';
  return parseDate(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  const box = t;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 2600);
}
