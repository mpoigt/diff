'use strict';

/**
 * Администрирование пользователей.
 *
 * Разграничение доступа задаётся в routes/users.routes.js через roleGuard:
 *   GET    /api/users            — moderator и выше (просмотр списка)
 *   GET    /api/users/:id        — свой профиль или moderator и выше
 *   PATCH  /api/users/:id/role   — только admin
 *   POST   /api/users/:id/unlock — только admin (снять блокировку)
 *   DELETE /api/users/:id        — только admin
 *   GET    /api/admin/audit-log  — только admin
 *
 * Все изменяющие операции обёрнуты в middleware audit() — мера №7.
 * Ни один метод не возвращает passwordHash: модель User переопределяет
 * toJSON(), а наружу отдаётся toPublicJSON().
 */

const { Op } = require('sequelize');
const ApiError = require('../middleware/ApiError');
const { User } = require('../models/user.model');
const { AuditLog } = require('../models/auditLog.model');
const { Diff } = require('../models/diff.model');
const { revokeAllSessions } = require('../services/token.service');
const { logger, logSuspicious } = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users?role=&search=&limit=&offset=
// ─────────────────────────────────────────────────────────────────────────────
async function list(req, res, next) {
  try {
    const { role, search, limit, offset } = req.query;

    // Условие собирается операторами Sequelize (Op.iLike), а значение
    // уходит в драйвер отдельным параметром — подстановка SQL невозможна
    const where = {};
    if (role) where.role = role;
    if (search) where.email = { [Op.iLike]: `%${search}%` };

    const { rows, count } = await User.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      // Явный список колонок: хеш пароля и токены не выбираются из БД вообще
      attributes: ['id', 'email', 'role', 'lastLoginAt', 'lockUntil', 'createdAt', 'updatedAt'],
    });

    return res.status(200).json({
      total: count,
      count: rows.length,
      limit,
      offset,
      items: rows.map((user) => user.toPublicJSON()),
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/:id — свой профиль либо moderator/admin
// ─────────────────────────────────────────────────────────────────────────────
async function getOne(req, res, next) {
  try {
    const isSelf = req.params.id === req.user.id;

    if (!isSelf && !req.user.hasAtLeastRole('moderator')) {
      // Попытка посмотреть чужой профиль — подозрительное действие
      logSuspicious('FOREIGN_PROFILE_ACCESS', req, { targetId: req.params.id });
      return next(ApiError.forbidden('Доступен только свой профиль'));
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return next(ApiError.notFound('Пользователь не найден'));

    const diffsCount = await Diff.count({ where: { ownerId: user.id } });

    return res.status(200).json({ ...user.toPublicJSON(), diffsCount });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/users/:id/role — только admin
// ─────────────────────────────────────────────────────────────────────────────
async function updateRole(req, res, next) {
  try {
    const { role } = req.body; // других полей схема не пропустит (мера №9)

    const user = await User.findByPk(req.params.id);
    if (!user) return next(ApiError.notFound('Пользователь не найден'));

    // Админ не может понизить сам себя: иначе легко остаться без админов
    if (user.id === req.user.id && role !== 'admin') {
      return next(ApiError.badRequest('Нельзя понизить собственную роль администратора'));
    }

    const previousRole = user.role;
    user.role = role;
    // Смена роли должна подействовать немедленно, а не через 15 минут,
    // поэтому обесцениваем уже выданные токены пользователя
    user.tokenVersion += 1;
    await user.save();
    await revokeAllSessions(user.id);

    logger.info('Изменена роль пользователя', {
      actorId: req.user.id, targetId: user.id, previousRole, newRole: role,
    });

    res.locals.audit = { previousRole, newRole: role };
    return res.status(200).json({
      message: `Роль изменена: ${previousRole} -> ${role}`,
      user: user.toPublicJSON(),
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/users/:id/unlock — только admin (снять блокировку, мера №6)
// ─────────────────────────────────────────────────────────────────────────────
async function unlock(req, res, next) {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return next(ApiError.notFound('Пользователь не найден'));

    const wasLocked = user.isLocked();
    user.lockUntil = null;
    user.failedAttempts = 0;
    await user.save();

    logger.info('Снята блокировка аккаунта', { actorId: req.user.id, targetId: user.id, wasLocked });

    return res.status(200).json({
      message: wasLocked ? 'Блокировка снята' : 'Аккаунт не был заблокирован',
      user: user.toPublicJSON(),
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/users/:id — только admin
// ─────────────────────────────────────────────────────────────────────────────
async function remove(req, res, next) {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return next(ApiError.notFound('Пользователь не найден'));

    if (user.id === req.user.id) {
      return next(ApiError.badRequest('Нельзя удалить собственную учётную запись администратора'));
    }

    // Защита от «обезглавливания» системы: последнего админа удалить нельзя
    if (user.role === 'admin') {
      const admins = await User.count({ where: { role: 'admin' } });
      if (admins <= 1) {
        return next(ApiError.badRequest('Нельзя удалить последнего администратора'));
      }
    }

    await revokeAllSessions(user.id);
    await user.destroy(); // сравнения останутся, ownerId станет NULL (onDelete: SET NULL)

    logger.warn('Удалён пользователь', {
      actorId: req.user.id, targetId: user.id, targetEmail: user.email,
    });

    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/audit-log — только admin (мера №7)
// ─────────────────────────────────────────────────────────────────────────────
async function auditLog(req, res, next) {
  try {
    const { action, actorId, limit, offset } = req.query;

    const where = {};
    if (action) where.action = action;
    if (actorId) where.actorId = actorId;

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      total: count, count: rows.length, limit, offset, items: rows,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, getOne, updateRole, unlock, remove, auditLog };
