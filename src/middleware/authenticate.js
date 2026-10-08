'use strict';

/**
 * Проверка access-токена (JWT).
 *
 * Токен ожидается в заголовке `Authorization: Bearer <token>`.
 * Этапы проверки:
 *   1. наличие и формат заголовка;
 *   2. подпись и срок действия (jwt.verify, алгоритм зафиксирован HS256);
 *   3. пользователь всё ещё существует в БД;
 *   4. аккаунт не заблокирован (мера №6);
 *   5. tokenVersion из токена совпадает с текущей в БД — это позволяет
 *      мгновенно обесценить все выданные токены (смена пароля, бан).
 *
 * Токен не доверяем «на слово»: роль берём из БД, а не из payload, —
 * иначе понижение роли админом не подействует до истечения токена.
 */

const jwt = require('jsonwebtoken');
const ApiError = require('./ApiError');
const { verifyAccessToken } = require('../services/token.service');
const { User } = require('../models/user.model');
const { logSuspicious } = require('../utils/logger');

function extractToken(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token.trim();
}

/**
 * @param {{optional?: boolean}} [options] optional=true — если токена нет,
 *        запрос продолжается как анонимный (нужно для публичных GET,
 *        где авторизованному пользователю хочется показать больше данных).
 */
function authenticate(options = {}) {
  const { optional = false } = options;

  return async (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
      if (optional) return next();
      logSuspicious('AUTH_MISSING_TOKEN', req);
      return next(ApiError.unauthorized('Не передан токен доступа (Authorization: Bearer <token>)'));
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logSuspicious('AUTH_TOKEN_EXPIRED', req);
        return next(ApiError.unauthorized('Срок действия токена истёк, обновите его через POST /auth/refresh'));
      }
      // Неверная подпись — почти всегда попытка подделать токен
      logSuspicious('AUTH_TOKEN_INVALID', req, { reason: error.message });
      return next(ApiError.unauthorized('Недействительный токен доступа'));
    }

    try {
      const user = await User.findByPk(payload.sub);

      if (!user) {
        logSuspicious('AUTH_USER_NOT_FOUND', req, { userId: payload.sub });
        return next(ApiError.unauthorized('Пользователь токена не найден'));
      }
      if (user.isLocked()) {
        logSuspicious('AUTH_LOCKED_ACCOUNT', req, { userId: user.id, email: user.email });
        return next(ApiError.locked('Аккаунт временно заблокирован'));
      }
      if (payload.tv !== user.tokenVersion) {
        logSuspicious('AUTH_TOKEN_REVOKED', req, { userId: user.id });
        return next(ApiError.unauthorized('Токен отозван, войдите заново'));
      }

      // Роль берём из БД (актуальную), а не из payload
      req.user = user;
      req.auth = { tokenPayload: payload };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { authenticate, extractToken };
