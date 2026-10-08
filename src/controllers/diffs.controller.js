'use strict';

/**
 * CRUD основной сущности курсового проекта — сравнение двух файлов.
 *
 * Разграничение прав (задаётся в routes/diffs.routes.js):
 *   GET    /api/diffs            — публично, без токена
 *   GET    /api/diffs/:id        — публично
 *   GET    /api/diffs/:id/patch  — публично (unified-представление, text/plain)
 *   POST   /api/diffs            — любой аутентифицированный пользователь
 *   PUT    /api/diffs/:id        — владелец записи либо moderator/admin
 *   PATCH  /api/diffs/:id        — владелец записи либо moderator/admin
 *   DELETE /api/diffs/:id        — только admin
 *
 * Все обращения к БД идут через Sequelize: значения подставляются
 * параметрами ($1, $2, ...), поэтому содержимое полей не может повлиять
 * на структуру SQL-запроса (защита от SQL-инъекций).
 *
 * Поля id, ownerId, author, stats, changes, createdAt задаёт сервер.
 * Клиент может передать только title, fileA, fileB — остальное отсекает
 * Joi-схема с allowUnknown: false (мера №9, mass assignment).
 */

const { Op } = require('sequelize');
const ApiError = require('../middleware/ApiError');
const { Diff } = require('../models/diff.model');
const { computeDiff, toUnifiedText } = require('../utils/diffEngine');
const { logger } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diffs?search=&author=&onlyChanged=&limit=&offset=&include=changes
// ─────────────────────────────────────────────────────────────────────────────
async function getAll(req, res, next) {
  try {
    const { search, author, onlyChanged, include, limit, offset } = req.query;

    const where = {};

    // Op.iLike — регистронезависимый поиск. Строка пользователя попадает
    // в запрос как параметр, а не склеивается с текстом SQL
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { fileAName: { [Op.iLike]: `%${search}%` } },
        { fileBName: { [Op.iLike]: `%${search}%` } },
      ];
    }
    if (author) {
      where.author = { [Op.iLike]: author };
    }
    if (onlyChanged) {
      // Фильтр по полю внутри JSONB: stats->>'identical' = 'false'
      where['stats.identical'] = false;
    }

    const { rows, count } = await Diff.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      total: count,
      count: rows.length,
      limit,
      offset,
      items: include === 'changes'
        ? rows.map((row) => row.toApiJSON())
        : rows.map((row) => row.toSummaryJSON()),
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diffs/:id
// ─────────────────────────────────────────────────────────────────────────────
async function getOne(req, res, next) {
  try {
    const diff = await Diff.findByPk(req.params.id);
    if (!diff) {
      return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
    }
    return res.status(200).json(diff.toApiJSON());
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diffs/:id/patch — unified-представление, text/plain
// ─────────────────────────────────────────────────────────────────────────────
async function getPatch(req, res, next) {
  try {
    const diff = await Diff.findByPk(req.params.id);
    if (!diff) {
      return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
    }

    // Явные Content-Type и charset + nosniff от helmet: браузер отдаст
    // это как текст и не попытается исполнить содержимое как HTML/JS
    res.type('text/plain; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="diff.patch"');
    return res.status(200).send(toUnifiedText(diff.toApiJSON()));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/diffs — требует аутентификации
// ─────────────────────────────────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    const { title, fileA, fileB } = req.body;
    const { changes, stats } = computeDiff(fileA.content, fileB.content);

    // Поля перечисляются поимённо — никакого Diff.create(req.body):
    // даже если валидатор когда-нибудь ослабят, лишние поля сюда не попадут
    const diff = await Diff.create({
      title,
      author: req.user.email,   // автор = текущий пользователь, а не то, что он прислал
      ownerId: req.user.id,
      fileAName: fileA.name,
      fileAContent: fileA.content,
      fileBName: fileB.name,
      fileBContent: fileB.content,
      stats,
      changes,
    });

    logger.info('Создано сравнение', { diffId: diff.id, ownerId: req.user.id });

    res.location(`/api/diffs/${diff.id}`);
    return res.status(201).json(diff.toApiJSON());
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/diffs/:id — полная замена; владелец либо moderator/admin
// ─────────────────────────────────────────────────────────────────────────────
async function replace(req, res, next) {
  try {
    // Запись уже загружена и проверена на владение в ownerOrRole
    const diff = req.resource;
    const { title, fileA, fileB } = req.body;
    const { changes, stats } = computeDiff(fileA.content, fileB.content);

    await diff.update({
      title,
      fileAName: fileA.name,
      fileAContent: fileA.content,
      fileBName: fileB.name,
      fileBContent: fileB.content,
      stats,
      changes,
      // author и ownerId сознательно НЕ меняем: владелец ресурса
      // не должен подменяться при редактировании модератором
    });

    return res.status(200).json(diff.toApiJSON());
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/diffs/:id — частичное обновление; владелец либо moderator/admin
// ─────────────────────────────────────────────────────────────────────────────
async function patch(req, res, next) {
  try {
    const diff = req.resource;
    const { title, fileA, fileB } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (fileA !== undefined) {
      updates.fileAName = fileA.name;
      updates.fileAContent = fileA.content;
    }
    if (fileB !== undefined) {
      updates.fileBName = fileB.name;
      updates.fileBContent = fileB.content;
    }

    // Пересчёт diff нужен только если менялось содержимое файлов
    if (fileA !== undefined || fileB !== undefined) {
      const contentA = updates.fileAContent !== undefined ? updates.fileAContent : diff.fileAContent;
      const contentB = updates.fileBContent !== undefined ? updates.fileBContent : diff.fileBContent;
      const { changes, stats } = computeDiff(contentA, contentB);
      updates.changes = changes;
      updates.stats = stats;
    }

    await diff.update(updates);

    return res.status(200).json(diff.toApiJSON());
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/diffs/:id — только admin
// ─────────────────────────────────────────────────────────────────────────────
async function remove(req, res, next) {
  try {
    const diff = await Diff.findByPk(req.params.id);
    if (!diff) {
      return next(ApiError.notFound(`Сравнение с id=${req.params.id} не найдено`));
    }

    await diff.destroy();
    logger.warn('Удалено сравнение', {
      diffId: req.params.id, actorId: req.user.id, actorRole: req.user.role,
    });

    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

/** Загрузчик для middleware ownerOrRole. */
function loadDiff(req) {
  return Diff.findByPk(req.params.id);
}

module.exports = { getAll, getOne, getPatch, create, replace, patch, remove, loadDiff };
