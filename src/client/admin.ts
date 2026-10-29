// Панель хостес: зал «сейчас», брони на сегодня, посадка гостей.
import type {
  Booking, BookingsResponse, BookingStatus, Restaurant, RestaurantsResponse, TablesResponse, TableStatus,
} from '../shared/types.js';
import {
  $, STATE_LABEL, api, escapeHtml, getSeatingStats, onLiveUpdate, parseSeatedMs, plural, renderHall, toast, todayStr,
} from './hall.js';

type Tab = 'all' | 'booked' | 'seated' | 'closed';

const STATUS: Record<BookingStatus, string> = { booked: 'Ожидается', seated: 'За столом', done: 'Ушли', cancelled: 'Отменена' };
const TABS: [Tab, string][] = [
  ['all', 'Все'],
  ['booked', 'Ждём'],
  ['seated', 'Сидят'],
  ['closed', 'Закрыты'],
];
let current!: Restaurant; // задаётся в init
let states: TableStatus[] = [];
let bookings: Booking[] = [];
let selectedId: string | null = null;
let tab: Tab = 'all';
let liveTimerInterval: ReturnType<typeof setInterval> | null = null;

$('logout').onclick = async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
};

function tick(): void {
  const d = new Date();
  $('clock').innerHTML = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) +
    `<small>${d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</small>`;
}

async function load(): Promise<void> {
  const [t, b] = await Promise.all([
    api<TablesResponse>(`/api/tables?restaurant=${current.id}`), // без даты — значит «сейчас»
    api<BookingsResponse>(`/api/bookings?restaurant=${current.id}&date=${todayStr()}`),
  ]);
  states = t.tables;
  bookings = b.bookings;
  draw();
}

function draw(): void {
  $('title').textContent = current.name;
  renderHall($('hall'), current, {
    states,
    selected: selectedId,
    tipExtra: (_t, s) => {
      const b = bookings.find((x) => x.id === s.bookingId);
      if (s.state === 'seated') {
        const ms = parseSeatedMs((b && b.seatedAt) || s.seatedAt, b ? b.date : undefined, b ? b.time : undefined);
        const stats = ms ? getSeatingStats(ms) : null;
        const timeInfo = stats ? `⏱️ Сели в ${stats.seatedTimeStr} (сидят ${stats.elapsedFormatted})` : '';
        const guestInfo = b ? `${escapeHtml(b.name)} · ${b.guests} гост.` : '';
        return [guestInfo, timeInfo].filter(Boolean).join('<br>');
      }
      return b ? `${escapeHtml(b.name)} · ${b.guests} гост.` : '';
    },
    onSelect: (t) => { selectedId = t.id; draw(); },
  });
  const c = { free: 0, booked: 0, seated: 0 };
  states.forEach((s) => c[s.state]++);
  const n = states.length || 1;
  const pct = (x: number) => (x / n) * 100 + '%';
  $('stFree').textContent = String(c.free);
  $('stBooked').textContent = String(c.booked);
  $('stSeated').textContent = String(c.seated);
  $('stLoad').textContent = Math.round(((c.booked + c.seated) / n) * 100) + '%';
  $('bFree').style.width = pct(c.free);
  $('bBooked').style.width = pct(c.booked);
  $('bSeated').style.width = pct(c.seated);
  $('bLoadS').style.width = pct(c.seated);
  $('bLoadB').style.width = pct(c.booked);
  renderPanel();
  renderList();
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

function renderPanel(): void {
  if (liveTimerInterval) {
    clearInterval(liveTimerInterval);
    liveTimerInterval = null;
  }

  const p = $('panel');
  const t = current.tables.find((x) => x.id === selectedId);
  const s = t && states.find((x) => x.id === t.id);
  if (!t || !s) {
    p.innerHTML = `<h3>Стол не выбран</h3>
      <p class="muted" style="margin:6px 0 0;font-size:14px">Нажмите на стол на схеме, чтобы посадить гостей, отметить приход или освободить стол.</p>`;
    return;
  }
  const b = bookings.find((x) => x.id === s.bookingId);
  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <h3>Стол ${t.id}</h3>
      <span class="st-badge ${s.state}">${STATE_LABEL[s.state]}</span>
    </div>
    <div class="muted" style="font-size:14px;margin-top:2px">${escapeHtml(t.zone)} · ${t.seats} ${plural(t.seats, 'место', 'места', 'мест')}</div>`;

  // Карточка гостя
  if (b) {
    html += `<div class="guest">
      <div class="av">${escapeHtml(initials(b.name))}</div>
      <div><b>${escapeHtml(b.name)}</b>
      <small>${b.time} · ${b.guests} гост.${b.phone ? ' · ' + escapeHtml(b.phone) : ''}</small></div></div>`;
  } else {
    html += '<div style="height:14px"></div>';
  }

  // Если гости сидят — выводим таймер посадки с отсчётом времени
  if (s.state === 'seated') {
    const seatedIso = (b && b.seatedAt) || s.seatedAt || (b && b.createdAt);
    const seatedMs = parseSeatedMs(seatedIso, b ? b.date : undefined, b ? b.time : undefined) || Date.now();
    const stats = getSeatingStats(seatedMs);

    html += `
      <div class="seated-timer-card">
        <div class="st-timer-head">
          <div class="st-timer-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div>
            <div class="st-timer-title">Отсчёт времени</div>
            <div class="st-timer-seated-at">Сели в <b>${stats.seatedTimeStr}</b></div>
          </div>
        </div>

        <div class="st-timer-body">
          <span class="st-timer-val ${stats.isOverLimit ? 'danger' : stats.isWarning ? 'warn' : ''}" id="liveTimerVal">${stats.timerDigits}</span>
          <span class="st-timer-label">время за столом</span>
        </div>

        <div class="st-progress">
          <div class="st-progress-bar">
            <div class="st-progress-fill ${stats.isOverLimit ? 'danger' : stats.isWarning ? 'warn' : ''}" id="liveProgressFill" style="width: ${stats.progressPct}%"></div>
          </div>
          <div class="st-progress-info">
            <span>Лимит: 2 часа</span>
            <b id="liveRemaining" class="${stats.isOverLimit ? 'text-danger' : stats.isWarning ? 'text-warn' : ''}">${stats.remainingText}</b>
          </div>
        </div>
      </div>`;

    // Запускаем тикающий таймер каждую секунду
    liveTimerInterval = setInterval(() => {
      const curStats = getSeatingStats(seatedMs);
      const valEl = document.getElementById('liveTimerVal');
      const barEl = document.getElementById('liveProgressFill');
      const remEl = document.getElementById('liveRemaining');
      if (valEl) {
        valEl.textContent = curStats.timerDigits;
        valEl.className = `st-timer-val ${curStats.isOverLimit ? 'danger' : curStats.isWarning ? 'warn' : ''}`;
      }
      if (barEl) {
        barEl.style.width = `${curStats.progressPct}%`;
        barEl.className = `st-progress-fill ${curStats.isOverLimit ? 'danger' : curStats.isWarning ? 'warn' : ''}`;
      }
      if (remEl) {
        remEl.textContent = curStats.remainingText;
        remEl.className = curStats.isOverLimit ? 'text-danger' : curStats.isWarning ? 'text-warn' : '';
      }
    }, 1000);
  }

  html += '<div class="actions">';
  if (s.state === 'free') {
    html += `
      <div class="actions-row">
        <div class="stepper" style="flex:0 0 auto">
          <button type="button" id="wMinus">−</button><output id="wCount" style="min-width:64px">2 гост.</output><button type="button" id="wPlus">+</button>
        </div>
        <button class="btn blue" id="walkin">Посадить</button>
      </div>`;
  } else if (b && s.state === 'booked') {
    html += `<button class="btn blue" data-act="seated" data-id="${b.id}">Гости пришли</button>
             <button class="btn soft-red" data-act="cancelled" data-id="${b.id}">Отменить бронь</button>`;
  } else if (b) {
    html += `<button class="btn" data-act="done" data-id="${b.id}">Освободить стол</button>`;
  }
  html += '</div><p class="error" id="err" style="margin-top:10px"></p>';
  p.innerHTML = html;

  if (s.state === 'free') {
    let w = Math.min(2, t.seats);
    const upd = () => {
      $('wCount').textContent = `${w} гост.`;
      $<HTMLButtonElement>('wMinus').disabled = w <= 1;
      $<HTMLButtonElement>('wPlus').disabled = w >= t.seats;
    };
    upd();
    $('wMinus').onclick = () => { w--; upd(); };
    $('wPlus').onclick = () => { w++; upd(); };
    $('walkin').onclick = () => run(() => api('/api/walkin', {
      method: 'POST', body: { restaurantId: current.id, tableId: t.id, guests: w },
    }), 'Гости посажены');
  }
  p.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(bindAction);
}

function inTab(b: Booking, k: Tab): boolean {
  if (k === 'all') return true;
  if (k === 'closed') return b.status === 'done' || b.status === 'cancelled';
  return b.status === k;
}

function renderList(): void {
  $('tabs').innerHTML = TABS.map(([k, label]) =>
    `<button class="${k === tab ? 'active' : ''}" data-tab="${k}">${label}<em>${bookings.filter((b) => inTab(b, k)).length}</em></button>`).join('');
  $('tabs').querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.onclick = () => { tab = btn.dataset.tab as Tab; renderList(); };
  });

  const list = bookings.filter((b) => inTab(b, tab));
  const ul = $('list');
  if (!list.length) { ul.innerHTML = '<li class="empty">Здесь пока пусто</li>'; return; }
  ul.innerHTML = list.map((b) => {
    let seatedBadge = '';
    if (b.status === 'seated') {
      const ms = parseSeatedMs(b.seatedAt, b.date, b.time);
      if (ms) {
        const stats = getSeatingStats(ms);
        seatedBadge = `<div class="seated-chip">⏱️ Сели в ${stats.seatedTimeStr} · ${stats.elapsedFormatted}</div>`;
      }
    }
    return `
    <li data-table="${b.tableId}">
      <span class="time">${b.time}</span>
      <span class="who">
        <b>${escapeHtml(b.name)}</b>
        <small>Стол ${b.tableId} · ${b.guests} гост.</small>
        ${seatedBadge}
      </span>
      <span class="st-badge ${b.status}">${STATUS[b.status]}</span>
    </li>`;
  }).join('');
  ul.querySelectorAll<HTMLElement>('li[data-table]').forEach((li) => {
    li.onclick = () => { selectedId = li.dataset.table ?? null; draw(); };
  });
}

const ACT_MSG: Record<string, string> = { seated: 'Гости за столом', done: 'Стол свободен', cancelled: 'Бронь отменена' };
function bindAction(btn: HTMLButtonElement): void {
  const act = btn.dataset.act ?? '';
  btn.onclick = () => run(
    () => api(`/api/bookings/${btn.dataset.id}`, { method: 'PATCH', body: { status: act } }),
    ACT_MSG[act]
  );
}

async function run(fn: () => Promise<unknown>, msg: string): Promise<void> {
  try {
    await fn();
    toast(msg);
    await load();
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    const err = document.getElementById('err');
    if (err) err.textContent = text;
    else toast(text);
  }
}

async function init(): Promise<void> {
  const data = await api<RestaurantsResponse>('/api/restaurants');
  current = data.restaurants[0];
  tick();
  await load();
  onLiveUpdate((msg) => { if (msg.restaurantId === current.id) load(); });
  // раз в минуту обновляем часы и статусы (брони наступают по времени)
  setInterval(() => { tick(); load(); }, 60000);
}
init();
