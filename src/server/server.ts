// Bron MVP — сервер бронирования столиков.
// Без внешних зависимостей в рантайме: только встроенные модули Node.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { restaurants } from './restaurants.js';
import type { Booking, BookingStatus, TableStatus } from '../shared/types.js';

type Req = http.IncomingMessage;
type Res = http.ServerResponse;

// Скомпилированный файл лежит в dist/server, корень проекта — на два уровня выше.
const ROOT = path.resolve(__dirname, '..', '..');
// Настройки (пароль панели и т.п.) можно держать в файле .env в корне проекта.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // файла нет — берём только переменные окружения
}
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = process.env.BRON_DATA || path.join(ROOT, 'data', 'bookings.json');
const BOOKING_HOURS = 2; // сколько длится одна бронь
const OPEN_HOUR = 10;
const CLOSE_HOUR = 23;

// ---------- хранилище броней ----------
function loadBookings(): Booking[] | null {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Booking[];
  } catch {
    return null;
  }
}
function save(): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2));
}

// ---------- время ----------
// Дата и время приходят как "YYYY-MM-DD" и "HH:MM" (локальное время сервера).
function toMs(date: string, time: string): number {
  return new Date(`${date}T${time}:00`).getTime();
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function nowParts(): { date: string; time: string } {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
const newId = (): string => crypto.randomUUID().slice(0, 8);

// Демо-данные при первом запуске: несколько броней и занятых столов на сегодня,
// чтобы на схеме сразу были видны все три цвета.
function seedDemo(): Booking[] {
  const now = nowParts();
  const h = new Date().getHours();
  const soon = `${pad(Math.min(Math.max(h + 1, OPEN_HOUR), CLOSE_HOUR - BOOKING_HOURS))}:00`;
  const mk = (restaurantId: string, tableId: string, time: string, name: string, guests: number, status: BookingStatus, seatedMinAgo?: number): Booking => {
    const nowMs = Date.now();
    const seatedIso = status === 'seated'
      ? new Date(nowMs - (seatedMinAgo || 35) * 60 * 1000).toISOString()
      : undefined;
    return {
      id: newId(),
      restaurantId, tableId, date: now.date, time, name,
      phone: status === 'seated' && name === 'Гости без брони' ? '' : '+7 900 123-45-67',
      guests, status, createdAt: seatedIso || new Date().toISOString(),
      seatedAt: seatedIso,
    };
  };
  return [
    mk('sakura', 'S3', now.time, 'Анна', 3, 'seated', 25),
    mk('sakura', 'S6', now.time, 'Гости без брони', 2, 'seated', 50),
    mk('sakura', 'S8', now.time, 'Гости без брони', 2, 'seated', 85),
    mk('sakura', 'S1', soon, 'Илья', 2, 'booked'),
    mk('sakura', 'S5', soon, 'Марина', 5, 'booked'),
    mk('sakura', 'S10', soon, 'Корпоратив ООО «Ромашка»', 6, 'booked'),
  ];
}

const loaded = loadBookings();
if (loaded) {
  for (const b of loaded) {
    if (b.status === 'seated' && !b.seatedAt) {
      b.seatedAt = b.createdAt || new Date().toISOString();
    }
  }
}
const bookings: Booking[] = loaded ?? seedDemo();
if (!loaded) save();

function overlaps(b: Booking, startMs: number): boolean {
  const bStart = toMs(b.date, b.time);
  const len = BOOKING_HOURS * 3600 * 1000;
  return bStart < startMs + len && startMs < bStart + len;
}
function active(b: Booking): boolean {
  return b.status === 'booked' || b.status === 'seated';
}

// Статус каждого стола на выбранный слот: free | booked | seated
function tableStates(restaurantId: string | null, date: string, time: string): TableStatus[] | null {
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
      seatedAt: seated ? (seated.seatedAt || seated.createdAt) : null,
    };
  });
}

// ---------- живые обновления (Server-Sent Events) ----------
const clients = new Set<Res>();
function broadcast(restaurantId: string): void {
  const msg = `data: ${JSON.stringify({ restaurantId })}\n\n`;
  for (const res of Array.from(clients)) {
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}

// ---------- HTTP-хелперы ----------
function sendJson(res: Res, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
// Тело запроса — непроверенный JSON, поэтому все поля unknown.
function readBody(req: Req): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c;
      if (raw.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        const v: unknown = raw ? JSON.parse(raw) : {};
        resolve(v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// ---------- вход в панель заведения ----------
// Пароль задаётся в ADMIN_PASSWORD. После входа браузер получает cookie с подписью
// (HMAC от пароля): сервер ничего не хранит, а смена пароля разлогинивает всех.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LyuTebya';
const SESSION_COOKIE = 'bron_admin';
const SESSION_DAYS = 7;
const sessionKey = crypto.createHash('sha256').update(`bron-admin:${ADMIN_PASSWORD}`).digest();

function sign(value: string): string {
  return crypto.createHmac('sha256', sessionKey).update(value).digest('hex');
}
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function getCookie(req: Req, name: string): string | null {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function isAdmin(req: Req): boolean {
  if (!ADMIN_PASSWORD) return false;
  const [exp, mac] = (getCookie(req, SESSION_COOKIE) || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign(exp));
}
function sessionCookie(req: Req, value: string, maxAgeSec: number): string {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

// Защита от подбора: после 5 неверных паролей с одного IP — пауза 5 минут.
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60 * 1000;
const loginFails = new Map<string, { count: number; until: number }>();
function clientIp(req: Req): string {
  return req.socket.remoteAddress || '?';
}

function redirect(res: Res, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
function serveStatic(req: Req, res: Res, pathname: string): void {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/login') pathname = '/login.html';
  // панель — только после входа, страница входа — только до него
  if (pathname === '/admin.html' && !isAdmin(req)) return redirect(res, '/login');
  if (pathname === '/login.html' && isAdmin(req)) return redirect(res, '/admin');
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не найдено');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // HTML не кешируем, чтобы после выхода панель не открывалась из кеша
      ...(ext === '.html' ? { 'Cache-Control': 'no-store' } : {}),
    });
    res.end(buf);
  });
}

// ---------- проверка входных данных ----------
function validSlot(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return 'Неверная дата или время';
  const h = Number(time.slice(0, 2));
  if (h < OPEN_HOUR || h > CLOSE_HOUR - BOOKING_HOURS) {
    return `Бронь доступна с ${OPEN_HOUR}:00 до ${CLOSE_HOUR - BOOKING_HOURS}:00`;
  }
  return null;
}

// ---------- маршруты API ----------
async function api(req: Req, res: Res, url: URL): Promise<void> {
  const p = url.pathname;
  const q = url.searchParams;

  // Маршруты панели заведения — только после входа.
  const adminOnly =
    (req.method === 'GET' && p === '/api/bookings') ||
    (req.method === 'PATCH' && p.startsWith('/api/bookings/')) ||
    (req.method === 'POST' && p === '/api/walkin');
  if (adminOnly && !isAdmin(req)) return sendJson(res, 401, { error: 'Нужно войти в панель заведения' });

  if (req.method === 'POST' && p === '/api/login') {
    if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: 'Пароль панели не задан на сервере (ADMIN_PASSWORD)' });
    const ip = clientIp(req);
    const fails = loginFails.get(ip);
    if (fails && fails.count >= MAX_TRIES && fails.until > Date.now()) {
      const min = Math.ceil((fails.until - Date.now()) / 60000);
      return sendJson(res, 429, { error: `Слишком много попыток. Попробуйте через ${min} мин.` });
    }
    const password = str((await readBody(req)).password);
    if (!safeEqual(password, ADMIN_PASSWORD)) {
      const count = fails && fails.until > Date.now() ? fails.count + 1 : 1;
      loginFails.set(ip, { count, until: Date.now() + LOCK_MS });
      return sendJson(res, 401, { error: 'Неверный пароль' });
    }
    loginFails.delete(ip);
    const exp = String(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
    res.setHeader('Set-Cookie', sessionCookie(req, `${exp}.${sign(exp)}`, SESSION_DAYS * 24 * 3600));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/logout') {
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return sendJson(res, 200, { ok: true });
  }

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
    res.on('error', () => clients.delete(res));
    return;
  }

  // Гость создаёт бронь
  if (req.method === 'POST' && p === '/api/bookings') {
    const body = await readBody(req);
    const restaurantId = str(body.restaurantId);
    const tableId = str(body.tableId);
    const date = str(body.date);
    const time = str(body.time);
    const name = str(body.name).trim();
    const phone = str(body.phone).trim();
    const r = restaurants.find((x) => x.id === restaurantId);
    const t = r && r.tables.find((x) => x.id === tableId);
    if (!t) return sendJson(res, 400, { error: 'Стол не найден' });
    const slotErr = validSlot(date, time);
    if (slotErr) return sendJson(res, 400, { error: slotErr });
    if (toMs(date, time) < Date.now() - 15 * 60 * 1000) return sendJson(res, 400, { error: 'Это время уже прошло' });
    if (!name) return sendJson(res, 400, { error: 'Укажите имя' });
    if (!/^[\d+\-\s()]{6,20}$/.test(phone)) return sendJson(res, 400, { error: 'Укажите телефон' });
    const g = Number(body.guests) || 1;
    if (g > t.seats) return sendJson(res, 400, { error: `Этот стол рассчитан максимум на ${t.seats} чел.` });

    const state = tableStates(restaurantId, date, time)?.find((s) => s.id === tableId);
    if (state?.state !== 'free') return sendJson(res, 409, { error: 'Этот стол уже занят на выбранное время' });

    const booking: Booking = {
      id: newId(),
      restaurantId,
      tableId,
      date,
      time,
      name: name.slice(0, 60),
      phone,
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
    const status = str((await readBody(req)).status);
    if (status !== 'seated' && status !== 'done' && status !== 'cancelled') {
      return sendJson(res, 400, { error: 'Неверный статус' });
    }
    if (status === 'seated' && b.status !== 'seated') {
      b.seatedAt = new Date().toISOString();
    }
    b.status = status;
    save();
    broadcast(b.restaurantId);
    return sendJson(res, 200, { booking: b });
  }

  // Панель хостес: посадить гостей без брони (walk-in)
  if (req.method === 'POST' && p === '/api/walkin') {
    const body = await readBody(req);
    const restaurantId = str(body.restaurantId);
    const tableId = str(body.tableId);
    const r = restaurants.find((x) => x.id === restaurantId);
    if (!r || !r.tables.find((x) => x.id === tableId)) return sendJson(res, 400, { error: 'Стол не найден' });
    const now = nowParts();
    const state = tableStates(restaurantId, now.date, now.time)?.find((s) => s.id === tableId);
    if (state?.state !== 'free') return sendJson(res, 409, { error: 'Стол сейчас не свободен' });
    const nowIso = new Date().toISOString();
    const booking: Booking = {
      id: newId(),
      restaurantId,
      tableId,
      date: now.date,
      time: now.time,
      name: 'Гости без брони',
      phone: '',
      guests: Number(body.guests) || 1,
      status: 'seated',
      createdAt: nowIso,
      seatedAt: nowIso,
    };
    bookings.push(booking);
    save();
    broadcast(restaurantId);
    return sendJson(res, 201, { booking });
  }

  return sendJson(res, 404, { error: 'Не найдено' });
}

process.on('uncaughtException', (err) => {
  console.error('Неперехваченная ошибка:', err);
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
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
    if (!ADMIN_PASSWORD) console.warn('⚠ ADMIN_PASSWORD не задан — вход в панель закрыт. Добавьте его в файл .env');
  });
