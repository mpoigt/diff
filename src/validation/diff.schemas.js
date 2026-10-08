'use strict';

/** Joi-схемы основной сущности — сравнения файлов. */

const { Joi, pagination } = require('./common');
const { MAX_TITLE, MAX_CONTENT } = require('../models/diff.model');

const fileSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required()
    .messages({
      'string.empty': 'Имя файла не может быть пустым',
      'any.required': 'Поле "name" обязательно',
    }),
  content: Joi.string().allow('').max(MAX_CONTENT).required()
    .messages({
      'string.max': `Содержимое файла не должно превышать ${MAX_CONTENT} символов`,
      'any.required': 'Поле "content" обязательно',
    }),
});

// Разрешены ровно четыре поля. id, ownerId, author, stats, changes, createdAt
// клиент задать не может — они вычисляются сервером (мера №9).
const createDiff = Joi.object({
  title: Joi.string().trim().min(1).max(MAX_TITLE).required()
    .messages({
      'string.empty': 'Поле "title" не может быть пустым',
      'string.max': `Поле "title" не должно превышать ${MAX_TITLE} символов`,
      'any.required': 'Поле "title" обязательно',
    }),
  fileA: fileSchema.required().messages({ 'any.required': 'Поле "fileA" обязательно' }),
  fileB: fileSchema.required().messages({ 'any.required': 'Поле "fileB" обязательно' }),
});

// PUT — полная замена, набор полей тот же, что при создании.
const replaceDiff = createDiff;

// PATCH — частичное обновление, но минимум одно поле должно быть передано.
const patchDiff = Joi.object({
  title: Joi.string().trim().min(1).max(MAX_TITLE),
  fileA: fileSchema,
  fileB: fileSchema,
}).min(1).messages({
  'object.min': 'Укажите хотя бы одно из полей: title, fileA, fileB',
});

/**
 * Параметры строки запроса (мера №29).
 * Все поля описаны типами: search/author — строки с ограничением длины,
 * limit/offset — целые числа в диапазоне, onlyChanged — булево.
 * Любой другой параметр (?id=1 OR 1=1, ?sort=...) отклоняется ещё до
 * обращения к БД, а подозрительные конструкции пишутся в security-лог.
 */
const listQuery = Joi.object({
  search: Joi.string().trim().max(120).allow(''),
  author: Joi.string().trim().max(120).allow(''),
  onlyChanged: Joi.boolean().truthy('1').falsy('0'),
  include: Joi.string().valid('changes'),
  ...pagination,
});

module.exports = { createDiff, replaceDiff, patchDiff, listQuery, fileSchema };
