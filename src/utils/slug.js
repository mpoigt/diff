'use strict';

/**
 * Построение slug — человекочитаемого уникального идентификатора сравнения.
 *
 * Зачем он нужен. По заданию КР №1 у основной сущности должно быть поле,
 * которое либо уникально, либо требует валидации. Здесь оно и уникально,
 * и валидируется: slug — это второй способ адресовать запись
 * (GET /api/diffs/slug/:slug) в дополнение к UUID.
 *
 * UUID в ссылке неудобен для человека: /api/diffs/3c9a1f7e-... ничего не
 * говорит о содержимом. Slug вида `readme-pravki-pered-relizom` читается
 * и пригодится в клиентском приложении (КР №3) для «красивых» URL.
 * При этом UUID остаётся основным ключом: slug можно поменять, не ломая
 * внешние ссылки на id.
 *
 * Заголовки у нас русские, поэтому выполняется транслитерация: иначе
 * slug из «Правки в index.js» получился бы пустым.
 */

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ў: 'u', є: 'e', ї: 'i', ґ: 'g',
};

const MAX_SLUG = 140;

/** Формат, который принимает валидатор: строчные латинские буквы, цифры, дефисы. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Превращает произвольную строку в slug.
 * @param {string} source
 * @returns {string} может вернуть пустую строку, если во входе не было
 *                   ни букв, ни цифр — вызывающий код обязан это учесть
 */
function slugify(source) {
  return String(source || '')
    .toLowerCase()
    .split('')
    .map((char) => (TRANSLIT[char] !== undefined ? TRANSLIT[char] : char))
    .join('')
    // всё, что не латиница и не цифра, становится разделителем
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
}

/**
 * Уникальный slug: если базовый вариант занят, добавляется числовой суффикс
 * (`-2`, `-3`, ...). Проверка занятости делегируется вызывающему коду,
 * чтобы эта функция не зависела от модели и легко тестировалась.
 *
 * @param {string} source            исходная строка (обычно title)
 * @param {(slug: string) => Promise<boolean>} isTaken
 * @param {string} [fallback]        основа, если из source slug не получился
 * @returns {Promise<string>}
 */
async function uniqueSlug(source, isTaken, fallback = 'diff') {
  const base = slugify(source) || slugify(fallback) || 'diff';

  if (!await isTaken(base)) return base;

  // Ограничиваем число попыток: при коллизиях дальше работает
  // ограничение уникальности на уровне БД, которое вернёт 409
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base.slice(0, MAX_SLUG - 4)}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    if (!await isTaken(candidate)) return candidate;
  }

  // Крайний случай: добавляем метку времени
  return `${base.slice(0, MAX_SLUG - 8)}-${Date.now().toString(36)}`;
}

module.exports = { slugify, uniqueSlug, SLUG_PATTERN, MAX_SLUG };
