// Демо-заведения и схемы их залов.
// Координаты — в системе SVG 800×520. x, y — центр стола.
// shape: 'round' (r = радиус) или 'rect' (w × h).
// decor — элементы зала (окна, бар, вход), только для отображения.

const restaurants = [
  {
    id: 'sakura',
    name: 'Sakura',
    cuisine: 'Японская кухня',
    address: 'ул. Пушкина, 12',
    cover: 'linear-gradient(135deg, #f0607a, #b8325a)',
    tags: ['Суши', 'Бар', 'Тихий угол'],
    hours: '10:00–23:00',
    decor: [
      { type: 'window', x: 40, y: -4, w: 720, h: 8, label: 'Окна' },
      { type: 'bar', x: 560, y: 380, w: 220, h: 60, label: 'Бар' },
      { type: 'entrance', x: 340, y: 516, w: 120, h: 8, label: 'Вход' },
      { type: 'zone', x: 20, y: 300, w: 200, h: 200, label: 'Тихий угол' },
    ],
    tables: [
      { id: 'S1', shape: 'round', x: 110, y: 80, r: 34, seats: 2, zone: 'У окна' },
      { id: 'S2', shape: 'round', x: 250, y: 80, r: 34, seats: 2, zone: 'У окна' },
      { id: 'S3', shape: 'rect', x: 410, y: 80, w: 110, h: 64, seats: 4, zone: 'У окна' },
      { id: 'S4', shape: 'rect', x: 590, y: 80, w: 110, h: 64, seats: 4, zone: 'У окна' },
      { id: 'S5', shape: 'rect', x: 180, y: 210, w: 150, h: 70, seats: 6, zone: 'Центр зала' },
      { id: 'S6', shape: 'round', x: 400, y: 220, r: 42, seats: 4, zone: 'Центр зала' },
      { id: 'S7', shape: 'round', x: 580, y: 220, r: 42, seats: 4, zone: 'Центр зала' },
      { id: 'S8', shape: 'round', x: 80, y: 380, r: 32, seats: 2, zone: 'Тихий угол' },
      { id: 'S9', shape: 'round', x: 160, y: 450, r: 32, seats: 2, zone: 'Тихий угол' },
      { id: 'S10', shape: 'rect', x: 380, y: 390, w: 130, h: 70, seats: 6, zone: 'Центр зала' },
      { id: 'S11', shape: 'round', x: 600, y: 330, r: 24, seats: 1, zone: 'Барная стойка' },
      { id: 'S12', shape: 'round', x: 700, y: 330, r: 24, seats: 1, zone: 'Барная стойка' },
    ],
  },
  {
    id: 'trattoria',
    name: 'Trattoria Roma',
    cuisine: 'Итальянская кухня',
    address: 'пр. Ленина, 45',
    cover: 'linear-gradient(135deg, #f2a541, #c4561e)',
    tags: ['Паста', 'Терраса', 'Банкеты'],
    hours: '10:00–23:00',
    decor: [
      { type: 'window', x: -4, y: 40, w: 8, h: 440, label: 'Окна' },
      { type: 'bar', x: 600, y: 30, w: 170, h: 70, label: 'Бар' },
      { type: 'entrance', x: 796, y: 220, w: 8, h: 100, label: 'Вход' },
      { type: 'zone', x: 520, y: 330, w: 260, h: 170, label: 'Терраса' },
    ],
    tables: [
      { id: 'T1', shape: 'rect', x: 90, y: 90, w: 90, h: 64, seats: 4, zone: 'У окна' },
      { id: 'T2', shape: 'rect', x: 90, y: 210, w: 90, h: 64, seats: 4, zone: 'У окна' },
      { id: 'T3', shape: 'rect', x: 90, y: 330, w: 90, h: 64, seats: 4, zone: 'У окна' },
      { id: 'T4', shape: 'round', x: 90, y: 440, r: 34, seats: 2, zone: 'У окна' },
      { id: 'T5', shape: 'round', x: 270, y: 120, r: 40, seats: 4, zone: 'Центр зала' },
      { id: 'T6', shape: 'round', x: 420, y: 120, r: 40, seats: 4, zone: 'Центр зала' },
      { id: 'T7', shape: 'rect', x: 340, y: 280, w: 200, h: 80, seats: 8, zone: 'Банкетный стол' },
      { id: 'T8', shape: 'round', x: 270, y: 440, r: 34, seats: 2, zone: 'Центр зала' },
      { id: 'T9', shape: 'round', x: 410, y: 440, r: 34, seats: 2, zone: 'Центр зала' },
      { id: 'T10', shape: 'round', x: 600, y: 410, r: 38, seats: 4, zone: 'Терраса' },
      { id: 'T11', shape: 'round', x: 710, y: 410, r: 38, seats: 4, zone: 'Терраса' },
    ],
  },
];

module.exports = { restaurants };
