// Bron MVP — сервер бронирования столиков.
// Без внешних зависимостей: только встроенные модули Node.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.BRON_DATA || path.join(__dirname, 'data', 'bookings.json');
const BOOKING_HOURS = 2; // сколько длится одна бронь
const OPEN_HOUR = 10;
const CLOSE_HOUR = 23;

const { restaurants } = require('./data/restaurants.js');

// ---------- хранилище броней ----------
let bookings = null;
try {
  bookings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  bookings = null;
}
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2));
}

// ---------- время ----------
// Дата и время приходят как "YYYY-MM-DD" и "HH:MM" (локальное время сервера).
function toMs(date, time) {
  return new Date(`${date}T${time}:00`).getTime();
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function nowParts() {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
// Демо-данные при первом запуске: несколько броней и занятых столов на сегодня,
// чтобы на схеме сразу были видны все три цвета.
function seedDemo() {
  const now = nowParts();
  const h = new Date().getHours();
  const soon = `${pad(Math.min(Math.max(h + 1, OPEN_HOUR), CLOSE_HOUR - BOOKING_HOURS))}:00`;
  const mk = (restaurantId, tableId, time, name, guests, status) => ({
    id: crypto.randomUUID().slice(0, 8),
    restaurantId, tableId, date: now.date, time, name,
    phone: status === 'seated' && name === 'Гости без брони' ? '' : '+7 900 123-45-67',
    guests, status, createdAt: new Date().toISOString(),
  });
  return [
    mk('sakura', 'S3', now.time, 'Анна', 3, 'seated'),
    mk('sakura', 'S6', now.time, 'Гости без брони', 2, 'seated'),
    mk('sakura', 'S8', now.time, 'Гости без брони', 2, 'seated'),
    mk('sakura', 'S1', soon, 'Илья', 2, 'booked'),
    mk('sakura', 'S5', soon, 'Марина', 5, 'booked'),
    mk('sakura', 'S10', soon, 'Корпоратив ООО «Ромашка»', 6, 'booked'),
    mk('trattoria', 'T2', now.time, 'Олег', 4, 'seated'),
    mk('trattoria', 'T7', soon, 'День рождения', 8, 'booked'),
    mk('trattoria', 'T10', soon, 'Света', 3, 'booked'),
  ];
}
if (!bookings) {
  bookings = seedDemo();
  save();
}

function overlaps(b, startMs) {
  const bStart = toMs(b.date, b.time);
  const len = BOOKING_HOURS * 3600 * 1000;
  return bStart < startMs + len && startMs < bStart + len;
}
function active(b) {
  return b.status === 'booked' || b.status === 'seated';
}

// Статус каждого стола на выбранный слот: free | booked | seated
function tableStates(restaurantId, date, time) {
  const r = restaurants.find((x) => x.id === restaurantId);
  if (!r) return null;
  const startMs = toMs(date, time);
  return r.tables.map((t) => {
    const hits = bookings.filter(
      (b) => b.restaurantId === restaurantId && b.tableId === t.id && active(b) && overlaps(b, startMs)
    );
    const seated = hits.find((b) => b.status === 'seated');
    const booked = hits.find((b) => b.status === 'booked');
    const current = seated || booked;
    return {
      id: t.id,
      state: seated ? 'seated' : booked ? 'booked' : 'free',
      bookingId: current ? current.id : null,
      bookedFrom: current ? current.time : null,
    };
  });
}

// ---------- живые обновления (Server-Sent Events) ----------
const clients = new Set();
function broadcast(restaurantId) {
  const msg = `data: ${JSON.stringify({ restaurantId })}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- HTTP-хелперы ----------
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- проверка входных данных ----------
function validSlot(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return 'Неверная дата или время';
  const h = Number(time.slice(0, 2));
  if (h < OPEN_HOUR || h > CLOSE_HOUR - BOOKING_HOURS) {
    return `Бронь доступна с ${OPEN_HOUR}:00 до ${CLOSE_HOUR - BOOKING_HOURS}:00`;
  }
  return null;
}

// ---------- маршруты API ----------
async function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (req.method === 'GET' && p === '/api/restaurants') {
    return sendJson(res, 200, {
      restaurants,
      config: { bookingHours: BOOKING_HOURS, openHour: OPEN_HOUR, closeHour: CLOSE_HOUR },
    });
  }

  if (req.method === 'GET' && p === '/api/tables') {
    const now = nowParts();
    const date = q.get('date') || now.date;
    const time = q.get('time') || now.time;
    const states = tableStates(q.get('restaurant'), date, time);
    if (!states) return sendJson(res, 404, { error: 'Заведение не найдено' });
    return sendJson(res, 200, { date, time, tables: states });
  }

  if (req.method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': ok\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Гость создаёт бронь
  if (req.method === 'POST' && p === '/api/bookings') {
    const body = await readBody(req);
    const { restaurantId, tableId, date, time, name, phone, guests } = body;
    const r = restaurants.find((x) => x.id === restaurantId);
    const t = r && r.tables.find((x) => x.id === tableId);
    if (!t) return sendJson(res, 400, { error: 'Стол не найден' });
    const slotErr = validSlot(date, time);
    if (slotErr) return sendJson(res, 400, { error: slotErr });
    if (toMs(date, time) < Date.now() - 15 * 60 * 1000) return sendJson(res, 400, { error: 'Это время уже прошло' });
    if (!name || !String(name).trim()) return sendJson(res, 400, { error: 'Укажите имя' });
    if (!/^[\d+\-\s()]{6,20}$/.test(phone || '')) return sendJson(res, 400, { error: 'Укажите телефон' });
    const g = Number(guests) || 1;
    if (g > t.seats) return sendJson(res, 400, { error: `Этот стол рассчитан максимум на ${t.seats} чел.` });

    const state = tableStates(restaurantId, date, time).find((s) => s.id === tableId);
    if (state.state !== 'free') return sendJson(res, 409, { error: 'Этот стол уже занят на выбранное время' });

    const booking = {
      id: crypto.randomUUID().slice(0, 8),
      restaurantId,
      tableId,
      date,
      time,
      name: String(name).trim().slice(0, 60),
      phone: String(phone).trim(),
      guests: g,
      status: 'booked',
      createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    save();
    broadcast(restaurantId);
    return sendJson(res, 201, { booking });
  }

  // Панель хостес: список броней за день
  if (req.method === 'GET' && p === '/api/bookings') {
    const date = q.get('date') || nowParts().date;
    const list = bookings
      .filter((b) => b.restaurantId === q.get('restaurant') && b.date === date)
      .sort((a, b) => a.time.localeCompare(b.time));
    return sendJson(res, 200, { bookings: list });
  }

  // Панель хостес: смена статуса брони (seated / done / cancelled)
  const m = p.match(/^\/api\/bookings\/([\w-]+)$/);
  if (req.method === 'PATCH' && m) {
    const b = bookings.find((x) => x.id === m[1]);
    if (!b) return sendJson(res, 404, { error: 'Бронь не найдена' });
    const { status } = await readBody(req);
    if (!['seated', 'done', 'cancelled'].includes(status)) return sendJson(res, 400, { error: 'Неверный статус' });
    b.status = status;
    save();
    broadcast(b.restaurantId);
    return sendJson(res, 200, { booking: b });
  }

  // Панель хостес: посадить гостей без брони (walk-in)
  if (req.method === 'POST' && p === '/api/walkin') {
    const { restaurantId, tableId, guests } = await readBody(req);
    const r = restaurants.find((x) => x.id === restaurantId);
    if (!r || !r.tables.find((x) => x.id === tableId)) return sendJson(res, 400, { error: 'Стол не найден' });
    const now = nowParts();
    const state = tableStates(restaurantId, now.date, now.time).find((s) => s.id === tableId);
    if (state.state !== 'free') return sendJson(res, 409, { error: 'Стол сейчас не свободен' });
    const booking = {
      id: crypto.randomUUID().slice(0, 8),
      restaurantId,
      tableId,
      date: now.date,
      time: now.time,
      name: 'Гости без брони',
      phone: '',
      guests: Number(guests) || 1,
      status: 'seated',
      createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    save();
    broadcast(restaurantId);
    return sendJson(res, 201, { booking });
  }

  return sendJson(res, 404, { error: 'Не найдено' });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      serveStatic(req, res, url.pathname);
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: 'Ошибка сервера' });
    }
  })
  .listen(PORT, () => {
    console.log(`Bron запущен:  http://localhost:${PORT}`);
    console.log(`Панель хостес: http://localhost:${PORT}/admin`);
  });
