'use strict';

/**
 * Ролевая модель. Три роли с нарастающими правами:
 *
 *   user      (1) — зарегистрированный пользователь: создаёт свои сравнения,
 *                   редактирует и удаляет только СВОИ записи;
 *   moderator (2) — всё, что user, плюс правка/удаление чужих сравнений
 *                   и просмотр списка пользователей (модерация контента);
 *   admin     (3) — полный доступ: удаление сравнений и пользователей,
 *                   смена ролей, просмотр audit log.
 *
 * roleGuard(role) пропускает пользователя с уровнем НЕ НИЖЕ требуемого,
 * поэтому admin автоматически проходит там, где достаточно moderator.
 * Любая неудачная проверка — это попытка доступа к чужому/запретному
 * ресурсу, она пишется в security-лог (требование задания о логировании
 * подозрительных действий).
 */

const ApiError = require('./ApiError');
const { ROLE_LEVEL } = require('../models/user.model');
const { logSuspicious } = require('../utils/logger');

/**
 * @param {'user'|'moderator'|'admin'} requiredRole минимально необходимая роль
 */
function roleGuard(requiredRole) {
  if (!ROLE_LEVEL[requiredRole]) {
    throw new Error(`roleGuard: неизвестная роль "${requiredRole}"`);
  }

  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Требуется аутентификация'));
    }

    const actual = ROLE_LEVEL[req.user.role] || 0;
    if (actual < ROLE_LEVEL[requiredRole]) {
      logSuspicious('FORBIDDEN_ROLE', req, {
        requiredRole,
        actualRole: req.user.role,
      });
      // Сообщение намеренно не раскрывает, существует ли ресурс
      return next(ApiError.forbidden(`Операция доступна только для роли "${requiredRole}" и выше`));
    }

    return next();
  };
}

/**
 * Проверка владения ресурсом: свой ресурс — можно, чужой — только
 * модератору и админу. Применяется к PUT/PATCH сравнений.
 *
 * @param {(req) => Promise<object|null>} loader      загрузчик ресурса
 * @param {string} ownerField                         имя поля-владельца
 * @param {'moderator'|'admin'} overrideRole          роль, которой владение не требуется
 */
function ownerOrRole(loader, ownerField = 'ownerId', overrideRole = 'moderator') {
  return async (req, res, next) => {
    try {
      const resource = await loader(req);
      if (!resource) {
        return next(ApiError.notFound('Ресурс не найден'));
      }

      req.resource = resource;

      const isOwner = resource[ownerField] && resource[ownerField] === req.user.id;
      const canOverride = (ROLE_LEVEL[req.user.role] || 0) >= ROLE_LEVEL[overrideRole];

      if (!isOwner && !canOverride) {
        logSuspicious('FOREIGN_RESOURCE_ACCESS', req, {
          resourceId: resource.id,
          resourceOwner: resource[ownerField],
          actualRole: req.user.role,
        });
        return next(ApiError.forbidden('Можно изменять только свои записи'));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { roleGuard, ownerOrRole };
