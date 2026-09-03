'use strict';

const MAX_TITLE = 120;
const MAX_CONTENT = 100 * 1024; // 100 КБ на файл

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateFile(file, field, errors) {
  if (!isPlainObject(file)) {
    errors.push(`Поле "${field}" обязательно и должно быть объектом { name, content }`);
    return;
  }
  if (typeof file.name !== 'string' || file.name.trim() === '') {
    errors.push(`Поле "${field}.name" обязательно и должно быть непустой строкой`);
  }
  if (typeof file.content !== 'string') {
    errors.push(`Поле "${field}.content" обязательно и должно быть строкой`);
  } else if (file.content.length > MAX_CONTENT) {
    errors.push(`Поле "${field}.content" превышает лимит ${MAX_CONTENT} символов`);
  }
}

/**
 * Валидация тела запроса для POST /diffs и PUT /diffs/:id.
 * Возвращает массив сообщений об ошибках (пустой — данные корректны).
 */
function validateCreate(body) {
  const errors = [];

  if (!isPlainObject(body)) {
    return ['Тело запроса должно быть JSON-объектом'];
  }

  if (typeof body.title !== 'string' || body.title.trim() === '') {
    errors.push('Поле "title" обязательно и должно быть непустой строкой');
  } else if (body.title.length > MAX_TITLE) {
    errors.push(`Поле "title" не должно превышать ${MAX_TITLE} символов`);
  }

  if (body.author !== undefined && typeof body.author !== 'string') {
    errors.push('Поле "author" должно быть строкой');
  }

  validateFile(body.fileA, 'fileA', errors);
  validateFile(body.fileB, 'fileB', errors);

  return errors;
}

/**
 * Валидация тела для PATCH: все поля необязательны, но хотя бы одно должно быть.
 */
function validatePatch(body) {
  const errors = [];

  if (!isPlainObject(body)) {
    return ['Тело запроса должно быть JSON-объектом'];
  }

  const allowed = ['title', 'author', 'fileA', 'fileB'];
  const provided = allowed.filter((key) => body[key] !== undefined);

  if (provided.length === 0) {
    errors.push(`Укажите хотя бы одно из полей: ${allowed.join(', ')}`);
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      errors.push('Поле "title" должно быть непустой строкой');
    } else if (body.title.length > MAX_TITLE) {
      errors.push(`Поле "title" не должно превышать ${MAX_TITLE} символов`);
    }
  }

  if (body.author !== undefined && typeof body.author !== 'string') {
    errors.push('Поле "author" должно быть строкой');
  }

  if (body.fileA !== undefined) validateFile(body.fileA, 'fileA', errors);
  if (body.fileB !== undefined) validateFile(body.fileB, 'fileB', errors);

  return errors;
}

module.exports = { validateCreate, validatePatch };
