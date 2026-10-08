'use strict';

/**
 * Мера №19 — санитизация входных данных (удаление HTML-тегов)
 * и мера №29 — проверка строки запроса на признаки SQL-инъекции.
 *
 * ── Про XSS ─────────────────────────────────────────────────────────────────
 * Основная защита от XSS — экранирование НА ВЫВОДЕ (клиент вставляет текст
 * через textContent, а не innerHTML) плюс CSP. Но хранить в БД сырой
 * `<script>` тоже не нужно: любой сторонний потребитель API может оказаться
 * менее аккуратным. Поэтому на входе из «метаданных» (title, имена файлов,
 * email) теги вырезаются библиотекой sanitize-html.
 *
 * ВАЖНОЕ исключение: поля fileA.content / fileB.content НЕ санитизируются.
 * Это содержимое сравниваемых файлов — пользователь имеет полное право
 * сравнивать два HTML- или JS-файла, и вырезать из них теги означало бы
 * сломать саму функцию сервиса. Безопасность этих полей обеспечивается
 * исключительно экранированием на выводе (public/app.js использует
 * textContent) и Content-Security-Policy.
 *
 * ── Про SQL-инъекции ────────────────────────────────────────────────────────
 * Технически инъекции уже невозможны: все запросы к БД строит Sequelize
 * параметризованно. Детектор ниже не «защищает», а ВЫЯВЛЯЕТ попытку —
 * чтобы она попала в security-лог как подозрительное действие.
 */

const sanitizeHtml = require('sanitize-html');
const { logSuspicious } = require('../utils/logger');

/** Поля, содержимое которых трогать нельзя (это данные файлов). */
const RAW_PATHS = new Set(['fileA.content', 'fileB.content', 'content']);

/** Поля, которые нельзя приводить/чистить (пароли — как есть). */
const UNTOUCHED_PATHS = new Set(['password', 'newPassword', 'currentPassword', 'passwordConfirm', 'token']);

const STRIP_ALL = { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'discard' };

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Обратное преобразование HTML-сущностей в символы. */
function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Удаляет HTML-теги и нормализует пробелы.
 *
 * Работает в цикле «вырезать теги -> раскодировать сущности», пока
 * результат не перестанет меняться. Два момента, из-за которых нужен цикл:
 *
 *  1. sanitize-html экранирует «безопасные» символы: строка "v1 -> v2"
 *     превратилась бы в "v1 -&gt; v2" и в таком виде легла бы в БД.
 *     Мы храним ЧИСТЫЙ ТЕКСТ, а экранированием занимается вывод
 *     (на клиенте — textContent), поэтому сущности раскодируем обратно.
 *  2. Обратная сторона пункта 1: присланное "&lt;script&gt;alert(1)&lt;/script&gt;"
 *     после раскодирования станет настоящим тегом. Повторная итерация
 *     его вырезает, поэтому в итоге в значении нет тегов ни в каком виде.
 *
 * Цикл сходится за 2-3 шага, ограничение в 4 итерации — страховка.
 */
function cleanString(value) {
  let current = String(value).replace(/\u0000/g, '');

  for (let i = 0; i < 4; i += 1) {
    const next = decodeEntities(sanitizeHtml(current, STRIP_ALL));
    if (next === current) break;
    current = next;
  }

  return current.trim();
}

/**
 * Рекурсивный обход объекта с ограничением глубины
 * (защита от «глубоких» объектов, которыми можно нагрузить CPU).
 */
function walk(node, path = '', depth = 0, touched = []) {
  if (depth > 6 || node === null || node === undefined) return node;

  if (typeof node === 'string') {
    if (RAW_PATHS.has(path) || UNTOUCHED_PATHS.has(path)) return node;
    const cleaned = cleanString(node);
    if (cleaned !== node) touched.push(path || '(root)');
    return cleaned;
  }

  if (Array.isArray(node)) {
    return node.map((item, index) => walk(item, path ? `${path}.${index}` : String(index), depth + 1, touched));
  }

  if (typeof node === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      // Отрезаем прототипные ключи: защита от prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const childPath = path ? `${path}.${key}` : key;
      result[key] = walk(value, childPath, depth + 1, touched);
    }
    return result;
  }

  return node;
}

/** Санитизация тела запроса. */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const touched = [];
    req.body = walk(req.body, '', 0, touched);
    if (touched.length > 0) {
      // Если из данных что-то вырезано — это может быть попытка XSS
      logSuspicious('HTML_STRIPPED_FROM_INPUT', req, { fields: touched });
    }
  }
  return next();
}

// Характерные конструкции SQL-инъекций и NoSQL-операторов
const INJECTION_PATTERNS = [
  /(\%27)|(')|(--)|(\%23)|(#)/i,
  /\b(union\s+select|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+table|alter\s+table|truncate\s+table)\b/i,
  /\b(or|and)\b\s*\d+\s*=\s*\d+/i,
  /(sleep\s*\(|pg_sleep\s*\(|benchmark\s*\(|waitfor\s+delay)/i,
  /(\/\*|\*\/|;\s*(select|insert|update|delete|drop))/i,
  /\$(where|ne|gt|lt|regex|expr|function)\b/i,
];

function looksLikeInjection(value) {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Мера №29. Проверяет query-параметры (и :id в пути) на инъекционные
 * конструкции и, если находит, логирует и отвечает 400.
 * Содержимое тела запроса НЕ проверяется: в diff-сервисе пользователь
 * может легально сравнивать .sql-файлы со словом DROP TABLE.
 */
function detectInjectionInQuery(req, res, next) {
  const suspects = [];

  for (const [key, raw] of Object.entries(req.query || {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value === 'string' && looksLikeInjection(value)) {
        suspects.push({ param: key, value: value.slice(0, 200) });
      }
    }
  }
  for (const [key, value] of Object.entries(req.params || {})) {
    if (typeof value === 'string' && looksLikeInjection(value)) {
      suspects.push({ param: `:${key}`, value: value.slice(0, 200) });
    }
  }

  if (suspects.length > 0) {
    logSuspicious('SQL_INJECTION_ATTEMPT', req, { suspects });
    return res.status(400).json({
      error: 'Некорректные данные запроса',
      details: ['Параметры запроса содержат недопустимые символы'],
    });
  }

  return next();
}

module.exports = { sanitizeBody, detectInjectionInQuery, cleanString, looksLikeInjection };
