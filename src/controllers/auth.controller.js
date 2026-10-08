'use strict';

/**
 * Аутентификация и управление собственной учётной записью.
 *
 * Реализованные здесь меры безопасности:
 *   №3  проверка сложности пароля            (Joi-схема + utils/password)
 *   №5  JWT + refresh-токен в httpOnly cookie
 *   №6  блокировка после 5 неудачных входов на 15 минут
 *   №16 временный токен сброса пароля (1 час)
 *   №17 bcrypt.compare — сравнение за постоянное время
 *   №20 ограничение числа одновременных сессий
 *   №24 единообразные сообщения об ошибках входа
 */

const { Op } = require('sequelize');
const ApiError = require('../middleware/ApiError');
const config = require('../config/env');
const { User } = require('../models/user.model');
const { Session } = require('../models/session.model');
const {
  hashPassword, verifyPassword, burnTime, randomToken, sha256, PASSWORD_RULE_TEXT,
} = require('../utils/password');
const tokens = require('../services/token.service');
const { logger, logSuspicious } = require('../utils/logger');

/**
 * Единый текст ошибки для «нет такого email» и «неверный пароль».
 * Если тексты различать, по ответу можно перечислить зарегистрированных
 * пользователей (user enumeration) — поэтому ответ один и тот же.
 */
const GENERIC_LOGIN_ERROR = 'Неверный email или пароль';

/** Ответ после успешного входа/регистрации: токен + профиль. */
function authPayload(user, pair) {
  return {
    accessToken: pair.accessToken,
    tokenType: 'Bearer',
    expiresIn: config.jwt.accessTtl,
    user: user.toPublicJSON(),
  };
}

/** Устанавливает refresh-токен в httpOnly cookie (мера №5). */
function setRefreshCookie(res, pair) {
  res.cookie(
    tokens.REFRESH_COOKIE,
    pair.refreshToken,
    tokens.refreshCookieOptions(pair.refreshTtlMs),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/register
// ─────────────────────────────────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { email, password } = req.body;

    // Роль НИКОГДА не берётся из тела запроса: новый пользователь всегда 'user'.
    // Повысить роль может только администратор (мера №9, mass assignment).
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      logSuspicious('REGISTER_DUPLICATE_EMAIL', req, { email });
      return next(ApiError.conflict('Пользователь с таким email уже зарегистрирован'));
    }

    const user = await User.create({
      email,
      passwordHash: await hashPassword(password),
      role: 'user',
    });

    logger.info('Зарегистрирован пользователь', { userId: user.id, email: user.email });

    const pair = await tokens.issueTokenPair(user, req);
    setRefreshCookie(res, pair);

    return res.status(201).json(authPayload(user, pair));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });

    // Пользователя нет: всё равно «сжигаем» время на bcrypt-сравнении,
    // чтобы ответ занимал столько же, сколько при неверном пароле (мера №17)
    if (!user) {
      await burnTime();
      logSuspicious('LOGIN_FAILED_NO_USER', req, { email });
      return next(ApiError.unauthorized(GENERIC_LOGIN_ERROR));
    }

    // ── Мера №6: аккаунт заблокирован за перебор ────────────────────────────
    if (user.isLocked()) {
      const seconds = user.lockSecondsLeft();
      logSuspicious('LOGIN_BLOCKED_LOCKED_ACCOUNT', req, {
        userId: user.id, email: user.email, secondsLeft: seconds,
      });
      return next(ApiError.locked(
        `Аккаунт заблокирован после ${config.security.loginMaxAttempts} неудачных попыток входа. Повторите через ${Math.ceil(seconds / 60)} мин.`,
        { retryAfterSeconds: seconds },
      ));
    }

    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      // ── Мера №6: счётчик неудач и блокировка ──────────────────────────────
      user.failedAttempts += 1;

      const limit = config.security.loginMaxAttempts;
      if (user.failedAttempts >= limit) {
        user.lockUntil = new Date(Date.now() + config.security.loginLockMinutes * 60 * 1000);
        user.failedAttempts = 0; // факт блокировки уже зафиксирован в lockUntil
        await user.save();

        // Если пароль подбирают, возможно, он где-то утёк — гасим все сессии
        await tokens.revokeAllSessions(user.id);

        logSuspicious('ACCOUNT_LOCKED_BRUTE_FORCE', req, {
          userId: user.id,
          email: user.email,
          attempts: limit,
          lockMinutes: config.security.loginLockMinutes,
        });

        return next(ApiError.locked(
          `Превышено число попыток входа (${limit}). Аккаунт заблокирован на ${config.security.loginLockMinutes} мин.`,
        ));
      }

      await user.save();
      logSuspicious('LOGIN_FAILED_WRONG_PASSWORD', req, {
        userId: user.id,
        email: user.email,
        failedAttempts: user.failedAttempts,
        attemptsLeft: limit - user.failedAttempts,
      });

      return next(ApiError.unauthorized(GENERIC_LOGIN_ERROR));
    }

    // Успешный вход — сбрасываем счётчик неудач
    user.failedAttempts = 0;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const pair = await tokens.issueTokenPair(user, req);
    setRefreshCookie(res, pair);

    logger.info('Успешный вход', { userId: user.id, email: user.email, role: user.role });

    return res.status(200).json(authPayload(user, pair));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/me — требует access-токен
// ─────────────────────────────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    const activeSessions = await Session.count({
      where: { userId: req.user.id, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    });

    return res.status(200).json({
      user: req.user.toPublicJSON(),
      activeSessions,
      maxSessions: config.security.maxSessionsPerUser,
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/refresh — мера №5, ротация refresh-токена
// ─────────────────────────────────────────────────────────────────────────────
async function refresh(req, res, next) {
  try {
    // Токен берём ТОЛЬКО из httpOnly cookie, а не из тела запроса:
    // так его нельзя прочитать и переслать скриптом со страницы
    const token = req.cookies && req.cookies[tokens.REFRESH_COOKIE];
    if (!token) {
      return next(ApiError.unauthorized('Refresh-токен не передан'));
    }

    let payload;
    try {
      payload = tokens.verifyRefreshToken(token);
    } catch (error) {
      logSuspicious('REFRESH_TOKEN_INVALID', req, { reason: error.message });
      res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions(0));
      return next(ApiError.unauthorized('Недействительный refresh-токен'));
    }

    const session = await tokens.findActiveSession(token);
    if (!session) {
      // Подпись верна, но сессии нет -> токен уже использован или отозван.
      // Классический признак кражи токена: на всякий случай гасим все сессии.
      logSuspicious('REFRESH_TOKEN_REUSE', req, { userId: payload.sub });
      await tokens.revokeAllSessions(payload.sub);
      res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions(0));
      return next(ApiError.unauthorized('Сессия недействительна, войдите заново'));
    }

    const user = await User.findByPk(payload.sub);
    if (!user || user.tokenVersion !== payload.tv || user.isLocked()) {
      await tokens.revokeSession(session);
      res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions(0));
      return next(ApiError.unauthorized('Сессия недействительна, войдите заново'));
    }

    // Ротация: старая сессия отзывается, выдаётся новая пара токенов
    await tokens.revokeSession(session);
    const pair = await tokens.issueTokenPair(user, req);
    setRefreshCookie(res, pair);

    return res.status(200).json(authPayload(user, pair));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────────────────────────
async function logout(req, res, next) {
  try {
    const token = req.cookies && req.cookies[tokens.REFRESH_COOKIE];
    if (token) {
      const session = await tokens.findActiveSession(token);
      await tokens.revokeSession(session);
    }
    res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions(0));
    return res.status(200).json({ message: 'Выход выполнен' });
  } catch (error) {
    return next(error);
  }
}

/** POST /auth/logout-all — закрыть сессии на всех устройствах. */
async function logoutAll(req, res, next) {
  try {
    const revoked = await tokens.revokeAllSessions(req.user.id);
    // Инкремент tokenVersion обесценивает и все выданные access-токены
    req.user.tokenVersion += 1;
    await req.user.save();
    res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions(0));
    return res.status(200).json({ message: 'Все сессии закрыты', revokedSessions: revoked });
  } catch (error) {
    return next(error);
  }
}

/** GET /auth/sessions — мера №20: показать свои активные сессии. */
async function sessions(req, res, next) {
  try {
    const list = await Session.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    return res.status(200).json({
      maxSessions: config.security.maxSessionsPerUser,
      items: list.map((item) => item.toPublicJSON()),
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/forgot-password — мера №16
// ─────────────────────────────────────────────────────────────────────────────
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });

    // Ответ одинаковый независимо от того, есть такой email или нет:
    // иначе эндпоинт превращается в средство проверки, кто зарегистрирован
    const genericResponse = {
      message: 'Если такой адрес зарегистрирован, на него отправлена инструкция по сбросу пароля',
    };

    if (!user) {
      logSuspicious('RESET_REQUEST_UNKNOWN_EMAIL', req, { email });
      return res.status(202).json(genericResponse);
    }

    const token = randomToken(48);              // 96 hex-символов
    user.resetTokenHash = sha256(token);        // в БД — только хеш
    user.resetTokenExpires = new Date(
      Date.now() + config.security.resetTokenTtlMinutes * 60 * 1000,
    );
    await user.save();

    logger.info('Создан токен сброса пароля', {
      userId: user.id,
      expiresAt: user.resetTokenExpires,
      ttlMinutes: config.security.resetTokenTtlMinutes,
    });

    // Почтовый сервис в лабораторной работе не поднимаем. В development
    // токен возвращается в ответе, чтобы можно было проверить сценарий;
    // в production он только логируется и ушёл бы письмом.
    if (!config.isProduction) {
      return res.status(202).json({
        ...genericResponse,
        devResetToken: token,
        devNote: 'Поле присутствует только при NODE_ENV=development',
        expiresAt: user.resetTokenExpires,
      });
    }

    return res.status(202).json(genericResponse);
  } catch (error) {
    return next(error);
  }
}

/** POST /auth/reset-password — мера №16. */
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;

    const user = await User.findOne({
      where: {
        resetTokenHash: sha256(token),
        // Срок жизни токена — 1 час: просроченный не подойдёт
        resetTokenExpires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      logSuspicious('RESET_TOKEN_INVALID_OR_EXPIRED', req);
      return next(ApiError.badRequest('Токен сброса недействителен или истёк'));
    }

    user.passwordHash = await hashPassword(password);
    user.resetTokenHash = null;        // одноразовый: гасим сразу
    user.resetTokenExpires = null;
    user.failedAttempts = 0;
    user.lockUntil = null;
    user.tokenVersion += 1;            // обесцениваем все выданные access-токены
    await user.save();

    // Смена пароля закрывает все сессии: если доступ был у постороннего, он потерян
    await tokens.revokeAllSessions(user.id);

    logger.info('Пароль сброшен по токену', { userId: user.id });

    return res.status(200).json({
      message: 'Пароль изменён. Войдите с новым паролем.',
      passwordPolicy: PASSWORD_RULE_TEXT,
    });
  } catch (error) {
    return next(error);
  }
}

/** POST /auth/change-password — смена пароля авторизованным пользователем. */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    const valid = await verifyPassword(currentPassword, req.user.passwordHash);
    if (!valid) {
      logSuspicious('CHANGE_PASSWORD_WRONG_CURRENT', req, { userId: req.user.id });
      return next(ApiError.unauthorized('Текущий пароль неверен'));
    }

    if (await verifyPassword(newPassword, req.user.passwordHash)) {
      return next(ApiError.badRequest('Новый пароль должен отличаться от текущего'));
    }

    req.user.passwordHash = await hashPassword(newPassword);
    req.user.tokenVersion += 1;
    await req.user.save();
    await tokens.revokeAllSessions(req.user.id);

    res.clearCookie(tokens.REFRESH_COOKIE, tokens.refreshCookieOptions(0));
    logger.info('Пароль изменён пользователем', { userId: req.user.id });

    return res.status(200).json({ message: 'Пароль изменён, войдите заново' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  register, login, me, refresh, logout, logoutAll, sessions,
  forgotPassword, resetPassword, changePassword,
};
