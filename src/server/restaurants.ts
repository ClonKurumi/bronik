// Демо-заведения и схемы их залов.
// Координаты — в системе SVG 800×520. x, y — центр стола.
// shape: 'round' (r = радиус) или 'rect' (w × h).
// decor — элементы зала (окна, бар, вход), только для отображения.

import type { Restaurant } from '../shared/types.js';

export const restaurants: Restaurant[] = [
  {
    id: 'sakura',
    name: 'База отдыха "Форель"',
    cuisine: '',
    address: 'ул. Пушкина, 12',
    cover: 'linear-gradient(135deg, #f0607a, #b8325a)',
    tags: ['Беседки', 'Озеро', 'Мангал'],
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
];
