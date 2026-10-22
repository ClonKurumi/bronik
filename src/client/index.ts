// Страница гостя: выбор заведения, времени и стола, оформление брони.
import type {
  Booking, BookingResponse, Config, Restaurant, RestaurantsResponse, Table, TablesResponse, TableStatus,
} from '../shared/types.js';
import {
  $, api, escapeHtml, formatDate, onLiveUpdate, pad, plural, renderHall, toast, todayStr,
} from './hall.js';

const MAX_GUESTS = 8;

let restaurants: Restaurant[] = [];
let config: Config = { bookingHours: 2, openHour: 10, closeHour: 23 };
let current!: Restaurant;       // выбранное заведение (задаётся в init)
let date = todayStr();
let time: string | null = null;
let guests = 2;
let statesBy: Record<string, TableStatus[]> = {}; // id заведения → статусы столов
let selectedId: string | null = null;
let lastBooking: { b: Booking; t: Table; r: Restaurant } | null = null; // экран подтверждения

const states = (): TableStatus[] => statesBy[current.id] || [];

// ---------- выбор даты / времени / гостей ----------
function slotsFor(d: string): string[] {
  const out: string[] = [];
  const isToday = d === todayStr();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let m = config.openHour * 60; m <= (config.closeHour - config.bookingHours) * 60; m += 30) {
    if (isToday && m + 15 < nowMin) continue;
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

function renderDays(): void {
  const box = $('days');
  box.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const v = todayStr(d);
    if (i === 0 && !slotsFor(v).length) continue; // сегодня уже поздно
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip day' + (v === date ? ' active' : '');
    const top = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : d.toLocaleDateString('ru-RU', { weekday: 'short' });
    b.innerHTML = `<small>${top}</small><b>${d.getDate()}</b>`;
    b.title = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    b.onclick = () => { date = v; selectedId = null; renderDays(); renderTimes(); load(); };
    box.appendChild(b);
  }
}

function renderTimes(): void {
  const slots = slotsFor(date);
  if (!time || !slots.includes(time)) time = slots[0] || null;
  const box = $('times');
  box.innerHTML = '';
  for (const v of slots) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (v === time ? ' active' : '');
    b.textContent = v;
    b.onclick = () => { time = v; selectedId = null; renderTimes(); load(); };
    box.appendChild(b);
  }
  const act = box.querySelector<HTMLElement>('.active');
  if (act) box.scrollLeft = act.offsetLeft - box.offsetLeft - 8;
}

function renderGuests(): void {
  $('guests').textContent = `${guests} ${plural(guests, 'гость', 'гостя', 'гостей')}`;
  $<HTMLButtonElement>('gMinus').disabled = guests <= 1;
  $<HTMLButtonElement>('gPlus').disabled = guests >= MAX_GUESTS;
}
function setGuests(n: number): void {
  guests = Math.max(1, Math.min(MAX_GUESTS, n));
  renderGuests();
  const t = current.tables.find((x) => x.id === selectedId);
  if (t && t.seats < guests) selectedId = null;
  draw();
}

// ---------- заведения ----------
function renderPlaces(): void {
  $('places').innerHTML = '';
  for (const r of restaurants) {
    const st = statesBy[r.id] || [];
    const free = st.filter((s) => s.state === 'free').length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'place' + (current.id === r.id ? ' active' : '');
    b.innerHTML = `
      <div class="place-cover" style="background:${r.cover}">${escapeHtml(r.name[0])}</div>
      <div>
        <div class="place-name">${escapeHtml(r.name)}</div>
        <div class="place-meta">${escapeHtml(r.cuisine)} · ${escapeHtml(r.address)}</div>
        <div class="place-tags">
          <span class="tag">${st.length ? `Свободно ${free} из ${st.length}` : `${r.tables.length} столов`}</span>
          ${(r.tags || []).slice(0, 2).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>`;
    b.onclick = () => { current = r; selectedId = null; lastBooking = null; renderPlaces(); draw(); };
    $('places').appendChild(b);
  }
}

// ---------- данные ----------
async function load(): Promise<void> {
  if (!time) { statesBy = {}; renderPlaces(); draw(); return; }
  const res = await Promise.all(restaurants.map((r) =>
    api<TablesResponse>(`/api/tables?restaurant=${r.id}&date=${date}&time=${time}`)));
  res.forEach((d, i) => { statesBy[restaurants[i].id] = d.tables; });
  const sel = states().find((s) => s.id === selectedId);
  if (sel && sel.state !== 'free') { selectedId = null; toast('Этот стол только что заняли'); }
  renderPlaces();
  draw();
}

// ---------- схема ----------
function draw(): void {
  const st = states();
  renderHall($('hall'), current, {
    states: st,
    selected: selectedId,
    isDisabled: (t, s) => s.state === 'free' && t.seats < guests,
    isLocked: (_t, s) => s.state !== 'free',
    tipExtra: (t, s) => (s.state === 'free' && t.seats < guests ? `Мало мест для ${guests} гостей` : s.state === 'free' ? 'Нажмите, чтобы выбрать' : ''),
    onSelect: (t) => {
      selectedId = t.id; lastBooking = null; draw();
      if (window.innerWidth < 960) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  const c = { free: 0, booked: 0, seated: 0 };
  st.forEach((s) => c[s.state]++);
  const total = st.length || 1;
  $('hallTitle').textContent = `${current.name} · ${current.cuisine.toLowerCase()}`;
  $('hallSub').textContent = time ? `${formatDate(date)}, ${time} — на ${config.bookingHours} часа` : 'Нет доступного времени';
  $('hallHint').textContent = time ? `Свободно ${c.free} из ${st.length} столов` : 'Выберите другую дату';
  $('mSeated').style.width = (c.seated / total) * 100 + '%';
  $('mBooked').style.width = (c.booked / total) * 100 + '%';

  let free = 0, tables = 0;
  for (const r of restaurants) {
    tables += r.tables.length;
    free += (statesBy[r.id] || []).filter((s) => s.state === 'free').length;
  }
  $('hsPlaces').textContent = String(restaurants.length);
  $('hsPlacesLbl').textContent = plural(restaurants.length, 'заведение', 'заведения', 'заведений');
  $('hsTables').textContent = String(tables);
  $('hsFree').textContent = time ? String(free) : '—';
  renderPanel();
}

// ---------- боковая панель ----------
function renderPanel(): void {
  const p = $('panel');
  const t = current.tables.find((x) => x.id === selectedId);
  if (!t && lastBooking) return renderTicket(lastBooking);
  if (!t) {
    p.innerHTML = `
      <div class="empty-state">
        <svg class="empty-ill" viewBox="0 0 120 90" fill="none">
          <rect x="20" y="10" width="80" height="70" rx="14" fill="var(--surface-2)" stroke="var(--line)"/>
          <circle cx="60" cy="45" r="16" fill="var(--gold)"/>
          <rect x="52" y="17" width="16" height="9" rx="4" fill="var(--chair)" stroke="var(--line-2)"/>
          <rect x="52" y="64" width="16" height="9" rx="4" fill="var(--chair)" stroke="var(--line-2)"/>
          <rect x="27" y="40" width="9" height="16" rx="4" fill="var(--chair)" stroke="var(--line-2)"/>
          <rect x="84" y="40" width="9" height="16" rx="4" fill="var(--chair)" stroke="var(--line-2)"/>
          <path d="M74 56l10 22 4-8 8-3z" fill="var(--ink)" stroke="var(--surface)" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <h3>Выберите стол</h3>
        <p>Нажмите на любой серый стол на схеме зала</p>
        <ul class="howto">
          <li><i style="background:var(--free-2)"></i>Серый — свободен, можно бронировать</li>
          <li><i style="background:var(--booked)"></i>Красный — уже забронирован</li>
          <li><i style="background:var(--seated)"></i>Синий — за столом сидят гости</li>
        </ul>
      </div>`;
    return;
  }
  p.innerHTML = `
    <div class="sel-head">
      <div class="sel-badge">${t.id}</div>
      <div>
        <h3>Стол ${t.id}</h3>
        <div class="muted" style="font-size:14px">${escapeHtml(t.zone)} · до ${t.seats} ${plural(t.seats, 'гостя', 'гостей', 'гостей')}</div>
      </div>
    </div>
    <div class="facts">
      <div class="fact"><small>Дата</small><b>${formatDate(date)}</b></div>
      <div class="fact"><small>Время</small><b>${time}</b></div>
      <div class="fact"><small>Гостей</small><b>${guests}</b></div>
      <div class="fact"><small>Место</small><b>${escapeHtml(current.name)}</b></div>
    </div>
    <form class="form" id="bookForm" novalidate>
      <label class="field"><span>Ваше имя</span>
        <input class="input" name="name" required maxlength="60" autocomplete="name" placeholder="Как к вам обращаться"></label>
      <label class="field"><span>Телефон</span>
        <input class="input" name="phone" type="tel" required autocomplete="tel" placeholder="+7 900 000-00-00"></label>
      <p class="error" id="err"></p>
      <button class="btn block" type="submit">Забронировать стол</button>
      <button class="link-btn" type="button" id="cancelSel">Выбрать другой стол</button>
      <p class="fine">Подтверждение придёт сразу — без звонков</p>
    </form>`;
  $('cancelSel').onclick = () => { selectedId = null; draw(); };
  const form = $<HTMLFormElement>('bookForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    btn.textContent = 'Бронируем…';
    $('err').textContent = '';
    try {
      const { booking } = await api<BookingResponse>('/api/bookings', {
        method: 'POST',
        body: {
          restaurantId: current.id, tableId: t.id, date, time, guests,
          name: f.get('name'), phone: f.get('phone'),
        },
      });
      lastBooking = { b: booking, t, r: current };
      selectedId = null;
      await load();
    } catch (err) {
      $('err').textContent = err instanceof Error ? err.message : String(err);
      btn.disabled = false;
      btn.textContent = 'Забронировать стол';
    }
  };
}

function renderTicket({ b, t, r }: { b: Booking; t: Table; r: Restaurant }): void {
  $('panel').innerHTML = `
    <div class="ticket">
      <div class="ticket-top">
        <div class="ok"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></div>
        <h3>Стол забронирован</h3>
        <p>Ждём вас в ${escapeHtml(r.name)}</p>
      </div>
      <div class="ticket-cut"></div>
      <div class="ticket-body">
        <div><small>Дата</small><b>${formatDate(b.date)}</b></div>
        <div><small>Время</small><b>${b.time}</b></div>
        <div><small>Стол</small><b>${t.id} · ${escapeHtml(t.zone)}</b></div>
        <div><small>Гостей</small><b>${b.guests}</b></div>
        <div style="grid-column:1/-1"><small>На имя</small><b>${escapeHtml(b.name)}</b></div>
        <div class="ticket-code"><small>Номер брони</small><b>${b.id.toUpperCase()}</b></div>
      </div>
    </div>
    <button class="btn ghost block" id="again" style="margin-top:14px">Забронировать ещё</button>`;
  $('again').onclick = () => { lastBooking = null; renderPanel(); };
}

// ---------- старт ----------
async function init(): Promise<void> {
  const data = await api<RestaurantsResponse>('/api/restaurants');
  restaurants = data.restaurants;
  config = data.config;
  // ссылка вида /?date=2026-10-23&time=19:00&restaurant=sakura открывает нужный слот
  const q = new URLSearchParams(location.search);
  const qDate = q.get('date') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate >= todayStr()) date = qDate;
  if (q.get('time')) time = q.get('time');
  current = restaurants.find((r) => r.id === q.get('restaurant')) || restaurants[0];
  if (!slotsFor(date).length) { const d = new Date(); d.setDate(d.getDate() + 1); date = todayStr(d); }
  renderDays();
  renderTimes();
  renderGuests();
  $('gMinus').onclick = () => setGuests(guests - 1);
  $('gPlus').onclick = () => setGuests(guests + 1);
  await load();
  // живое обновление: кто-то забронировал или хостес посадила гостей
  onLiveUpdate(() => load());
}
init();
