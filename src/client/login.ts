// Страница входа в панель заведения.
import { $, api } from './hall.js';

const form = $<HTMLFormElement>('loginForm');
const input = $<HTMLInputElement>('password');
const err = $('err');

form.onsubmit = async (e) => {
  e.preventDefault();
  if (!input.value) { err.textContent = 'Введите пароль'; return; }
  const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  btn.disabled = true;
  btn.textContent = 'Входим…';
  err.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: input.value } });
    location.href = '/admin';
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e);
    input.select();
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
};
