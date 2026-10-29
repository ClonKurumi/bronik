// Страница гостя: выбор заведения, времени и стола, оформление брони.
import type {
  Booking, BookingResponse, Config, Restaurant, RestaurantsResponse, Table, TablesResponse, TableStatus,
} from '../shared/types.js';
import {
  $, api, escapeHtml, formatDate, onLiveUpdate, pad, plural, renderHall, todayStr,
} from './hall.js';

let config: Config = { bookingHours: 2, openHour: 10, closeHour: 23 };
let current!: Restaurant;       // заведение (задаётся в init)
let date = todayStr();
let time: string | null = null;
let hour = 19;
let minute = 0;
let guests = 2;
let tableStates: TableStatus[] = []; // статусы столов на выбранное время
let selectedId: string | null = null;
let lastBooking: { b: Booking; t: Table; r: Restaurant } | null = null; // экран подтверждения

// Месяц, открытый в календаре
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-11
let calOpen = false;

const MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const MONTH_TITLES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// ---------- дата и слоты времени ----------
function formatFullDate(dStr: string): string {
  const [y, m, d] = dStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dStr === todayStr()) return `Сегодня, ${d} ${MONTH_NAMES[m - 1]}`;
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (dStr === todayStr(tm)) return `Завтра, ${d} ${MONTH_NAMES[m - 1]}`;
  const weekday = dt.toLocaleDateString('ru-RU', { weekday: 'long' });
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${cap}, ${d} ${MONTH_NAMES[m - 1]}`;
}

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

// ---------- данные ----------
async function load(): Promise<void> {
  if (!time) { tableStates = []; drawHall(); return; }
  const res = await api<TablesResponse>(`/api/tables?restaurant=${current.id}&date=${date}&time=${time}`);
  tableStates = res.tables;
  drawHall();
}

// ---------- схема зала ----------
function drawHall(): void {
  const st = tableStates;
  renderHall($('hall'), current, {
    states: st,
    selected: selectedId,
    isDisabled: () => false,
    isLocked: () => false,
    tipExtra: (_t, s) =>
      s.state === 'free'
        ? 'Нажмите, чтобы выбрать'
        : 'Занят на это время · Нажмите, чтобы выбрать другое',
    onSelect: (t) => {
      selectedId = t.id;
      if (guests > t.seats) guests = t.seats;
      lastBooking = null;
      drawHall();
      renderPanel();
      if (window.innerWidth < 960) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  const c = { free: 0, booked: 0, seated: 0 };
  st.forEach((s) => c[s.state]++);
  const total = st.length || 1;
  $('hallTitle').textContent = current.cuisine
    ? `${current.name} · ${current.cuisine.toLowerCase()}`
    : current.name;
  $('hallSub').textContent = time ? `${formatDate(date)}, ${time} — на ${config.bookingHours} часа` : 'Нет доступного времени';
  $('hallHint').textContent = time ? `Свободно ${c.free} из ${st.length} столов` : 'Выберите другую дату';
  $('mSeated').style.width = (c.seated / total) * 100 + '%';
  $('mBooked').style.width = (c.booked / total) * 100 + '%';

  $('hsTables').textContent = String(current.tables.length);
  $('hsFree').textContent = time ? String(c.free) : '—';
}

// ---------- проверка доступности выбранного столика ----------
function checkAvailability(): void {
  const t = current.tables.find((x) => x.id === selectedId);
  if (!t) return;
  const curState = tableStates.find((s) => s.id === t.id);
  const isFree = curState ? curState.state === 'free' : true;
  const alertEl = document.getElementById('pAlert');
  const btn = document.querySelector<HTMLButtonElement>('#bookForm button[type=submit]');

  // Проверка, не прошло ли время на сегодня
  let isPast = false;
  if (date === todayStr()) {
    const now = new Date();
    const curMinutes = now.getHours() * 60 + now.getMinutes();
    if (hour * 60 + minute + 10 < curMinutes) {
      isPast = true;
    }
  }

  if (alertEl) {
    if (isPast) {
      alertEl.textContent = `Это время (${time}) на сегодня уже прошло. Выберите время позже или другую дату.`;
      alertEl.style.display = 'block';
    } else if (!isFree) {
      alertEl.textContent = `Стол занят на ${time || 'это время'}. Выберите другое время на будильнике.`;
      alertEl.style.display = 'block';
    } else {
      alertEl.style.display = 'none';
    }
  }

  if (btn) {
    const disabled = !isFree || !time || isPast;
    btn.disabled = disabled;
    btn.textContent = isPast
      ? 'Это время уже прошло'
      : !isFree
      ? 'Стол занят на это время'
      : 'Забронировать стол';
  }
}

// ---------- календарь на месяц ----------
function renderCalendar(): void {
  const titleEl = document.getElementById('calMonthTitle');
  const gridEl = document.getElementById('calDaysGrid');
  const prevBtn = document.getElementById('calPrev') as HTMLButtonElement | null;
  if (!titleEl || !gridEl) return;

  titleEl.textContent = `${MONTH_TITLES[calMonth]} ${calYear}`;

  const now = new Date();
  const isCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth();
  if (prevBtn) prevBtn.disabled = isCurrentMonth;

  gridEl.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const startOffset = (firstDay + 6) % 7; // Понедельник = 0

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('span');
    empty.className = 'cal-empty';
    gridEl.appendChild(empty);
  }

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayStr();

  for (let day = 1; day <= daysInMonth; day++) {
    const dStr = `${calYear}-${pad(calMonth + 1)}-${pad(day)}`;
    const isPast = dStr < today;
    const isToday = dStr === today;
    const isSelected = dStr === date;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day' +
      (isToday ? ' today' : '') +
      (isSelected ? ' selected' : '');
    btn.textContent = String(day);
    btn.disabled = isPast;

    btn.onclick = async () => {
      date = dStr;
      setCalOpen(false);
      updateDateDisplay();
      await load();
      checkAvailability();
    };
    gridEl.appendChild(btn);
  }
}

function setCalOpen(open: boolean): void {
  calOpen = open;
  const drop = document.getElementById('calDropdown');
  const trig = document.getElementById('dateTrigger');
  if (drop) drop.style.display = open ? 'grid' : 'none';
  if (trig) trig.classList.toggle('open', open);
  if (open) renderCalendar();
}

function updateDateDisplay(): void {
  const trigText = document.getElementById('dateTriggerText');
  if (trigText) trigText.textContent = formatFullDate(date);

  const qT = document.getElementById('qToday');
  const qTm = document.getElementById('qTomorrow');
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (qT) qT.classList.toggle('active', date === todayStr());
  if (qTm) qTm.classList.toggle('active', date === todayStr(tm));
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
        <p>Нажмите на любой стол на схеме зала</p>
        <ul class="howto">
          <li><i style="background:var(--free-2)"></i>Серый — свободен</li>
          <li><i style="background:var(--booked)"></i>Красный — забронирован</li>
          <li><i style="background:var(--seated)"></i>Синий — гости за столом</li>
        </ul>
      </div>`;
    return;
  }

  // Привязываем месяц календаря к текущей дате
  const [dYear, dMonth] = date.split('-').map(Number);
  calYear = dYear;
  calMonth = dMonth - 1;
  calOpen = false;

  p.innerHTML = `
    <div class="sel-head">
      <div class="sel-badge">${t.id}</div>
      <div>
        <h3>Стол ${t.id}</h3>
        <div class="muted" style="font-size:14px">${escapeHtml(t.zone)} · до ${t.seats} ${plural(t.seats, 'гостя', 'гостей', 'гостей')}</div>
      </div>
    </div>

    <div class="picker-block">
      <!-- Дата и календарь -->
      <div class="picker-group">
        <div class="group-head">
          <span class="lbl">Дата</span>
          <div class="quick-dates">
            <button type="button" class="quick-btn" id="qToday">Сегодня</button>
            <button type="button" class="quick-btn" id="qTomorrow">Завтра</button>
          </div>
        </div>

        <button type="button" class="date-trigger" id="dateTrigger" aria-label="Открыть календарь">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span id="dateTriggerText">${escapeHtml(formatFullDate(date))}</span>
          <svg class="chevron" id="dateChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </button>

        <div class="cal-dropdown" id="calDropdown" style="display:none">
          <div class="cal-head">
            <button type="button" class="cal-nav" id="calPrev" aria-label="Предыдущий месяц">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <b class="cal-month-title" id="calMonthTitle"></b>
            <button type="button" class="cal-nav" id="calNext" aria-label="Следующий месяц">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <div class="cal-weekdays">
            <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
          </div>
          <div class="cal-days" id="calDaysGrid"></div>
        </div>
      </div>

      <!-- Будильник для выбора времени -->
      <div class="picker-group">
        <div class="group-head">
          <span class="lbl">Время</span>
          <span class="time-range-hint">с 10:00 до 21:00</span>
        </div>

        <div class="alarm-clock">
          <div class="alarm-unit">
            <button type="button" class="alarm-arr" id="hrUp" aria-label="Час вперед">
              <svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
            </button>
            <input type="text" inputmode="numeric" maxlength="2" id="hrInput" class="alarm-val" value="${pad(hour)}" aria-label="Часы">
            <button type="button" class="alarm-arr" id="hrDown" aria-label="Час назад">
              <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <span class="alarm-lbl">часы</span>
          </div>

          <div class="alarm-colon">:</div>

          <div class="alarm-unit">
            <button type="button" class="alarm-arr" id="minUp" aria-label="Минуты вперед">
              <svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
            </button>
            <input type="text" inputmode="numeric" maxlength="2" id="minInput" class="alarm-val" value="${pad(minute)}" aria-label="Минуты">
            <button type="button" class="alarm-arr" id="minDown" aria-label="Минуты назад">
              <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <span class="alarm-lbl">минуты</span>
          </div>

          <div class="alarm-quick">
            <button type="button" class="qtime-btn" data-h="12" data-m="0">12:00</button>
            <button type="button" class="qtime-btn" data-h="14" data-m="0">14:00</button>
            <button type="button" class="qtime-btn" data-h="18" data-m="0">18:00</button>
            <button type="button" class="qtime-btn" data-h="19" data-m="0">19:00</button>
            <button type="button" class="qtime-btn" data-h="20" data-m="0">20:00</button>
          </div>
        </div>
      </div>

      <!-- Гостей -->
      <div class="picker-group">
        <span class="lbl">Гостей</span>
        <div class="stepper-full">
          <button type="button" id="pMinus" aria-label="Меньше гостей">−</button>
          <output id="pGuests"></output>
          <button type="button" id="pPlus" aria-label="Больше гостей">+</button>
        </div>
      </div>
    </div>

    <div class="panel-alert" id="pAlert" style="display:none"></div>

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

  // Обработчики открытия календаря
  const trigBtn = $('dateTrigger');
  trigBtn.onclick = () => setCalOpen(!calOpen);

  $('calPrev').onclick = () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  };

  $('calNext').onclick = () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  };

  // Быстрые кнопки дат
  $('qToday').onclick = async () => {
    date = todayStr();
    const [y, m] = date.split('-').map(Number);
    calYear = y; calMonth = m - 1;
    setCalOpen(false);
    updateDateDisplay();
    await load();
    checkAvailability();
  };

  $('qTomorrow').onclick = async () => {
    const tm = new Date(); tm.setDate(tm.getDate() + 1);
    date = todayStr(tm);
    const [y, m] = date.split('-').map(Number);
    calYear = y; calMonth = m - 1;
    setCalOpen(false);
    updateDateDisplay();
    await load();
    checkAvailability();
  };

  updateDateDisplay();

  // Логика будильника (часы и минуты)
  const hrInput = $<HTMLInputElement>('hrInput');
  const minInput = $<HTMLInputElement>('minInput');
  const qBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.qtime-btn'));

  const updateQBtns = () => {
    qBtns.forEach((btn) => {
      const bh = Number(btn.dataset.h);
      const bm = Number(btn.dataset.m);
      btn.classList.toggle('active', bh === hour && bm === minute);
    });
  };

  const commitTime = async (h: number, m: number, syncInputs = true) => {
    // ограничение по времени работы ресторана
    hour = Math.max(config.openHour, Math.min(config.closeHour - config.bookingHours, h));
    minute = Math.max(0, Math.min(59, m));
    time = `${pad(hour)}:${pad(minute)}`;
    if (syncInputs) {
      hrInput.value = pad(hour);
      minInput.value = pad(minute);
    }
    updateQBtns();
    await load();
    checkAvailability();
  };

  updateQBtns();

  // Стрелки часов
  $('hrUp').onclick = () => {
    let next = hour + 1;
    if (next > config.closeHour - config.bookingHours) next = config.openHour;
    commitTime(next, minute);
  };
  $('hrDown').onclick = () => {
    let next = hour - 1;
    if (next < config.openHour) next = config.closeHour - config.bookingHours;
    commitTime(next, minute);
  };

  // Стрелки минут
  $('minUp').onclick = () => {
    let next = Math.floor(minute / 15) * 15 + 15;
    let h = hour;
    if (next >= 60) {
      next = 0;
      h++;
      if (h > config.closeHour - config.bookingHours) h = config.openHour;
    }
    commitTime(h, next);
  };
  $('minDown').onclick = () => {
    let next = Math.ceil(minute / 15) * 15 - 15;
    let h = hour;
    if (next < 0) {
      next = 45;
      h--;
      if (h < config.openHour) h = config.closeHour - config.bookingHours;
    }
    commitTime(h, next);
  };

  // Прокрутка колесом мыши
  hrInput.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) $('hrUp').click(); else $('hrDown').click();
  }, { passive: false });

  minInput.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) $('minUp').click(); else $('minDown').click();
  }, { passive: false });

  // Ввод с клавиатуры в часы
  hrInput.oninput = () => {
    hrInput.value = hrInput.value.replace(/\D/g, '').slice(0, 2);
    if (hrInput.value.length === 2) {
      commitTime(Number(hrInput.value), minute, false);
      minInput.focus();
      minInput.select();
    }
  };
  hrInput.onblur = () => {
    commitTime(Number(hrInput.value || hour), minute, true);
  };
  hrInput.onkeydown = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); $('hrUp').click(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); $('hrDown').click(); }
    else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      if (e.key === 'ArrowRight') { e.preventDefault(); minInput.focus(); minInput.select(); }
    }
    else if (e.key === 'Enter') { hrInput.blur(); }
  };

  // Ввод с клавиатуры в минуты
  minInput.oninput = () => {
    minInput.value = minInput.value.replace(/\D/g, '').slice(0, 2);
    if (minInput.value.length === 2) {
      commitTime(hour, Number(minInput.value), false);
    }
  };
  minInput.onblur = () => {
    commitTime(hour, Number(minInput.value || minute), true);
  };
  minInput.onkeydown = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); $('minUp').click(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); $('minDown').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); hrInput.focus(); hrInput.select(); }
    else if (e.key === 'Enter') { minInput.blur(); }
  };

  // Быстрые кнопки времени
  qBtns.forEach((btn) => {
    btn.onclick = () => {
      commitTime(Number(btn.dataset.h), Number(btn.dataset.m));
    };
  });

  // Степпер гостей
  const btnMinus = $<HTMLButtonElement>('pMinus');
  const btnPlus = $<HTMLButtonElement>('pPlus');
  const outGuests = $('pGuests');

  const updateGuests = () => {
    outGuests.textContent = `${guests} ${plural(guests, 'гость', 'гостя', 'гостей')}`;
    btnMinus.disabled = guests <= 1;
    btnPlus.disabled = guests >= t.seats;
  };
  updateGuests();

  btnMinus.onclick = () => {
    if (guests > 1) {
      guests--;
      updateGuests();
    }
  };

  btnPlus.onclick = () => {
    if (guests < t.seats) {
      guests++;
      updateGuests();
    }
  };

  checkAvailability();

  $('cancelSel').onclick = () => {
    selectedId = null;
    drawHall();
    renderPanel();
  };

  const form = $<HTMLFormElement>('bookForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!time) return;
    const curState = tableStates.find((s) => s.id === t.id);
    if (curState && curState.state !== 'free') return;

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
      renderPanel();
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
  current = data.restaurants[0];
  config = data.config;
  const q = new URLSearchParams(location.search);
  const qDate = q.get('date') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate >= todayStr()) date = qDate;

  // Инициализация времени
  const qTime = q.get('time');
  if (qTime && /^\d{2}:\d{2}$/.test(qTime)) {
    hour = Number(qTime.slice(0, 2));
    minute = Number(qTime.slice(3, 5));
  } else {
    // По умолчанию 19:00, либо ближайший час если сегодня уже позже
    const now = new Date();
    if (date === todayStr() && now.getHours() >= 19) {
      hour = Math.min(config.closeHour - config.bookingHours, now.getHours() + 1);
      minute = 0;
    } else {
      hour = 19;
      minute = 0;
    }
  }
  time = `${pad(hour)}:${pad(minute)}`;

  await load();
  renderPanel();
  // живое обновление: кто-то забронировал или хостес посадила гостей
  onLiveUpdate(() => load());

  // Закрытие календаря при клике вне него
  document.addEventListener('click', (e) => {
    if (!calOpen) return;
    const drop = document.getElementById('calDropdown');
    const trig = document.getElementById('dateTrigger');
    const target = e.target as Node | null;
    if (drop && trig && target && !drop.contains(target) && !trig.contains(target)) {
      setCalOpen(false);
    }
  });
}
init();
