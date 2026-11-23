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

const { Op, fn, col, cast, literal } = require('sequelize');
const ApiError = require('../middleware/ApiError');
const { Diff } = require('../models/diff.model');
const { computeDiff, computeStoredDiff, toUnifiedText } = require('../utils/diffEngine');
const { uniqueSlug } = require('../utils/slug');
const { logger } = require('../utils/logger');

/**
 * Белый список сортировок: ключ — значение параметра ?sort, значение —
 * готовое выражение ORDER BY для Sequelize.
 *
 * Именно белый список, а не подстановка имени колонки из запроса: иначе
 * ?sort=passwordHash раскрыл бы порядок по чужому полю, а более хитрое
 * значение попало бы прямо в текст ORDER BY. Joi-схема дополнительно
 * отвергает всё, чего здесь нет.
 */
// Выражение-константа: similarity лежит внутри JSONB-поля stats,
// для сортировки его нужно привести к числу
const SIMILARITY_EXPR = `("stats"->>'similarity')::int`;

const SORT_OPTIONS = {
  createdAt: [['createdAt', 'ASC']],
  '-createdAt': [['createdAt', 'DESC']],
  title: [['title', 'ASC']],
  '-title': [['title', 'DESC']],
  // similarity лежит внутри JSONB-поля stats, поэтому нужно приведение к int
  similarity: [[literal(SIMILARITY_EXPR), 'ASC']],
  '-similarity': [[literal(SIMILARITY_EXPR), 'DESC']],
};

/**
 * Подбирает свободный slug. Вынесено отдельно, потому что нужно
 * и при создании, и при обновлении записи.
 *
 * @param {string} source      строка-основа (title или присланный slug)
 * @param {string} [excludeId] id записи, которую не считаем конфликтом
 *                             (нужно при обновлении самой себя)
 */
function resolveSlug(source, excludeId) {
  return uniqueSlug(source, async (candidate) => {
    const where = { slug: candidate };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    return (await Diff.count({ where })) > 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diffs?search=&author=&onlyChanged=&limit=&offset=&include=changes
// ─────────────────────────────────────────────────────────────────────────────
async function getAll(req, res, next) {
  try {
    const { search, author, onlyChanged, include, limit, offset, sort } = req.query;

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
      order: SORT_OPTIONS[sort] || SORT_OPTIONS['-createdAt'],
      limit,
      offset,
    });

    return res.status(200).json({
      total: count,
      count: rows.length,
      limit,
      offset,
      sort,
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
// GET /api/diffs/slug/:slug — получение записи по уникальному полю slug
// ─────────────────────────────────────────────────────────────────────────────
async function getBySlug(req, res, next) {
  try {
    // Поиск по уникальному индексу: значение уходит параметром запроса
    const diff = await Diff.findOne({ where: { slug: req.params.slug } });
    if (!diff) {
      return next(ApiError.notFound(`Сравнение со slug="${req.params.slug}" не найдено`));
    }
    return res.status(200).json(diff.toApiJSON());
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/diffs/stats — дополнительный эндпоинт: подсчёт статистики
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Агрегаты считает СУБД, а не Node: выгружать все записи в память, чтобы
 * сложить числа, бессмысленно — содержимое файлов весит до 100 КБ каждое.
 * Все выражения — константы в коде, значение фильтра author уходит
 * параметром, поэтому подстановка в SQL невозможна.
 */
async function getStats(req, res, next) {
  try {
    const { author } = req.query;
    const where = author ? { author: { [Op.iLike]: author } } : {};

    const totals = await Diff.findOne({
      where,
      attributes: [
        [fn('COUNT', col('id')), 'totalDiffs'],
        [fn('COUNT', fn('DISTINCT', col('author'))), 'uniqueAuthors'],
        [fn('COALESCE', fn('SUM', cast(literal(`"stats"->>'added'`), 'integer')), 0), 'linesAdded'],
        [fn('COALESCE', fn('SUM', cast(literal(`"stats"->>'removed'`), 'integer')), 0), 'linesRemoved'],
        [fn('ROUND', fn('AVG', cast(literal(`"stats"->>'similarity'`), 'integer')), 1), 'avgSimilarity'],
        [fn('COUNT', literal(`CASE WHEN "stats"->>'identical' = 'true' THEN 1 END`)), 'identicalDiffs'],
      ],
      raw: true,
    });

    // Топ-5 авторов по числу сравнений
    const topAuthors = await Diff.findAll({
      where,
      attributes: ['author', [fn('COUNT', col('id')), 'diffs']],
      group: ['author'],
      order: [[literal('"diffs"'), 'DESC']],
      limit: 5,
      raw: true,
    });

    const toInt = (value) => Number(value || 0);

    return res.status(200).json({
      filter: author ? { author } : null,
      totalDiffs: toInt(totals.totalDiffs),
      uniqueAuthors: toInt(totals.uniqueAuthors),
      identicalDiffs: toInt(totals.identicalDiffs),
      linesAdded: toInt(totals.linesAdded),
      linesRemoved: toInt(totals.linesRemoved),
      netLineChange: toInt(totals.linesAdded) - toInt(totals.linesRemoved),
      avgSimilarity: totals.avgSimilarity === null ? null : Number(totals.avgSimilarity),
      topAuthors: topAuthors.map((row) => ({ author: row.author, diffs: toInt(row.diffs) })),
      generatedAt: new Date().toISOString(),
    });
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
    const { fileA, fileB } = diff.toApiJSON({ includeChanges: false });
    const { changes } = computeDiff(fileA.content, fileB.content, { ignoreTrailingWhitespace: false });
    return res.status(200).send(toUnifiedText({ fileA, fileB, changes }));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/diffs — требует аутентификации
// ─────────────────────────────────────────────────────────────────────────────
async function create(req, res, next) {
  try {
    const { title, slug, fileA, fileB } = req.body;
    const { changes, stats } = computeStoredDiff(fileA.content, fileB.content);

    // slug либо прислан клиентом (уже проверен по формату), либо строится
    // из заголовка; в обоих случаях проверяется на занятость
    const resolvedSlug = await resolveSlug(slug || title);

    // Поля перечисляются поимённо — никакого Diff.create(req.body):
    // даже если валидатор когда-нибудь ослабят, лишние поля сюда не попадут
    const diff = await Diff.create({
      slug: resolvedSlug,
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
    const { title, slug, fileA, fileB } = req.body;
    const { changes, stats } = computeStoredDiff(fileA.content, fileB.content);

    // PUT — полная замена: если slug не прислан, пересобираем его из нового
    // заголовка. Себя самого в конфликтах не учитываем (excludeId)
    const resolvedSlug = await resolveSlug(slug || title, diff.id);

    await diff.update({
      slug: resolvedSlug,
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
    const { title, slug, fileA, fileB } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    // slug меняем только если его передали явно: PATCH не должен
    // неожиданно ломать существующую ссылку при правке заголовка
    if (slug !== undefined) updates.slug = await resolveSlug(slug, diff.id);
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
      const { changes, stats } = computeStoredDiff(contentA, contentB);
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

module.exports = {
  getAll, getOne, getBySlug, getStats, getPatch, create, replace, patch, remove, loadDiff,
};
