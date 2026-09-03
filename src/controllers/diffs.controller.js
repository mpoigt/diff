'use strict';

const Diff = require('../models/diff.model');
const ApiError = require('../middleware/ApiError');
const { validateCreate, validatePatch } = require('../utils/validateDiff');
const { toUnifiedText } = require('../utils/diffEngine');

/** Краткая карточка сравнения — без тяжёлого массива changes. */
function toSummary(diff) {
  const { changes, fileA, fileB, ...rest } = diff;
  return {
    ...rest,
    fileA: { name: fileA.name },
    fileB: { name: fileB.name },
  };
}

function parsePositiveInt(value, field) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw ApiError.badRequest(`Параметр "${field}" должен быть целым неотрицательным числом`);
  }
  return num;
}

// GET /api/diffs?search=&author=&onlyChanged=true&limit=&offset=&include=changes
function getAll(req, res) {
  const { search, author, onlyChanged, include } = req.query;

  let items = Diff.findAll({
    search,
    author,
    onlyChanged: onlyChanged === 'true' || onlyChanged === '1',
  });

  const total = items.length;
  const offset = req.query.offset !== undefined ? parsePositiveInt(req.query.offset, 'offset') : 0;
  const limit = req.query.limit !== undefined ? parsePositiveInt(req.query.limit, 'limit') : total;

  items = items.slice(offset, offset + limit);

  res.status(200).json({
    total,
    count: items.length,
    offset,
    items: include === 'changes' ? items : items.map(toSummary),
  });
}

// GET /api/diffs/:id
function getOne(req, res, next) {
  const diff = Diff.findById(req.params.id);
  if (!diff) {
    return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
  }
  return res.status(200).json(diff);
}

// GET /api/diffs/:id/patch — unified-представление в виде text/plain
function getPatch(req, res, next) {
  const diff = Diff.findById(req.params.id);
  if (!diff) {
    return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
  }
  res.type('text/plain; charset=utf-8');
  return res.status(200).send(toUnifiedText(diff));
}

// POST /api/diffs
function create(req, res, next) {
  const errors = validateCreate(req.body);
  if (errors.length > 0) {
    return next(ApiError.badRequest('Некорректные данные запроса', errors));
  }

  const diff = Diff.create(req.body);
  res.location(`/api/diffs/${diff.id}`);
  return res.status(201).json(diff);
}

// PUT /api/diffs/:id — полная замена ресурса
function replace(req, res, next) {
  const errors = validateCreate(req.body);
  if (errors.length > 0) {
    return next(ApiError.badRequest('Некорректные данные запроса', errors));
  }

  const diff = Diff.replace(req.params.id, req.body);
  if (!diff) {
    return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
  }
  return res.status(200).json(diff);
}

// PATCH /api/diffs/:id — частичное обновление
function patch(req, res, next) {
  const errors = validatePatch(req.body);
  if (errors.length > 0) {
    return next(ApiError.badRequest('Некорректные данные запроса', errors));
  }

  const diff = Diff.update(req.params.id, req.body);
  if (!diff) {
    return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
  }
  return res.status(200).json(diff);
}

// DELETE /api/diffs/:id
function remove(req, res, next) {
  const deleted = Diff.remove(req.params.id);
  if (!deleted) {
    return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
  }
  return res.status(204).end();
}

module.exports = { getAll, getOne, getPatch, create, replace, patch, remove };
