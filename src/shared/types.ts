// Общие типы для сервера и клиента.

export type TableShape = 'round' | 'rect';
export type TableState = 'free' | 'booked' | 'seated';
export type BookingStatus = 'booked' | 'seated' | 'done' | 'cancelled';

interface TableBase {
  id: string;
  x: number;
  y: number;
  seats: number;
  zone: string;
}
export interface RoundTable extends TableBase { shape: 'round'; r: number }
export interface RectTable extends TableBase { shape: 'rect'; w: number; h: number }
export type Table = RoundTable | RectTable;

export interface Decor {
  type: 'window' | 'bar' | 'entrance' | 'zone';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  address: string;
  cover: string;
  tags?: string[];
  hours: string;
  decor: Decor[];
  tables: Table[];
}

export interface Booking {
  id: string;
  restaurantId: string;
  tableId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  name: string;
  phone: string;
  guests: number;
  status: BookingStatus;
  createdAt: string;
}

export interface TableStatus {
  id: string;
  state: TableState;
  bookingId: string | null;
  bookedFrom: string | null;
}

export interface Config {
  bookingHours: number;
  openHour: number;
  closeHour: number;
}

// Ответы API
export interface RestaurantsResponse { restaurants: Restaurant[]; config: Config }
export interface TablesResponse { date: string; time: string; tables: TableStatus[] }
export interface BookingsResponse { bookings: Booking[] }
export interface BookingResponse { booking: Booking }
export interface LiveMessage { restaurantId: string }
