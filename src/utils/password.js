'use strict';

/**
 * Работа с паролями.
 *
 * Мера №3 — политика сложности: минимум 8 символов, строчная и заглавная буквы,
 *           цифра и спецсимвол; отдельно отсекаем 20 самых популярных паролей.
 * Мера №17 — сравнение через bcrypt.compare: функция сравнивает хеши
 *           за постоянное время, поэтому по времени ответа нельзя угадывать пароль
 *           посимвольно (timing attack).
 *
 * bcrypt сам генерирует уникальную соль на каждый пароль и «растягивает»
 * вычисление (BCRYPT_ROUNDS=12 ≈ 0.3 с), что делает перебор по украденной
 * базе экономически бессмысленным. Пароль в открытом виде никуда не пишется.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('../config/env');

const MIN_LENGTH = 8;
const MAX_LENGTH = 128; // bcrypt учитывает только первые 72 байта; длинные пароли режем заранее

const BLACKLIST = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyui', 'iloveyou', 'admin123', 'administrator', 'welcome1',
  'letmein1', 'monkey12', 'football', 'baseball', 'dragon123', 'sunshine',
  'princess', 'passw0rd',
]);

/**
 * Проверка сложности пароля.
 * @returns {string[]} список ошибок; пустой массив — пароль подходит
 */
function checkPasswordStrength(password) {
  const errors = [];

  if (typeof password !== 'string') {
    return ['Пароль должен быть строкой'];
  }
  if (password.length < MIN_LENGTH) {
    errors.push(`Пароль должен содержать минимум ${MIN_LENGTH} символов`);
  }
  if (password.length > MAX_LENGTH) {
    errors.push(`Пароль не должен превышать ${MAX_LENGTH} символов`);
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Пароль должен содержать строчную латинскую букву');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Пароль должен содержать заглавную латинскую букву');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Пароль должен содержать цифру');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Пароль должен содержать специальный символ (!@#$%^&* и т.п.)');
  }
  if (/\s/.test(password)) {
    errors.push('Пароль не должен содержать пробелы');
  }
  if (BLACKLIST.has(password.toLowerCase())) {
    errors.push('Этот пароль слишком распространён, выберите другой');
  }

  return errors;
}

/** Хеширование пароля (bcrypt + автоматическая соль). */
function hashPassword(plain) {
  return bcrypt.hash(plain, config.security.bcryptRounds);
}

/** Сравнение пароля с хешем, устойчивое к timing-атакам. */
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * «Пустое» сравнение для несуществующего пользователя.
 * Нужно, чтобы время ответа на «нет такого email» и «неверный пароль» совпадало —
 * иначе по скорости ответа можно перечислить существующие аккаунты (user enumeration).
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalization', 10);
function burnTime() {
  return bcrypt.compare('dummy-password-for-timing-equalization', DUMMY_HASH);
}

/** Криптостойкий случайный токен (сброс пароля, refresh-токен). */
function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** SHA-256 — для хранения refresh-токенов и токенов сброса в виде хеша. */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
  burnTime,
  randomToken,
  sha256,
  MIN_LENGTH,
  MAX_LENGTH,
  PASSWORD_RULE_TEXT: 'минимум 8 символов, заглавная и строчная латинские буквы, цифра и спецсимвол, без пробелов',
};
