'use strict';

/**
 * Выдача и проверка токенов (мера №5 — JWT + refresh-токен в httpOnly cookie,
 * мера №20 — ограничение числа одновременных сессий).
 *
 * Схема работы:
 *   access-токен  — JWT, живёт 15 минут, подписан JWT_SECRET,
 *                   передаётся клиентом в заголовке Authorization: Bearer <...>.
 *                   Короткий срок жизни = окно использования украденного токена мало.
 *   refresh-токен — JWT, живёт 7 дней, подписан ДРУГИМ секретом
 *                   (JWT_REFRESH_SECRET), отдаётся клиенту ТОЛЬКО как
 *                   httpOnly + sameSite=strict cookie. JavaScript на странице
 *                   его прочитать не может, поэтому XSS не уводит долгоживущий
 *                   токен; sameSite=strict не даёт отправить cookie с чужого сайта,
 *                   что закрывает CSRF на эндпоинт /auth/refresh.
 *
 * В БД хранится не сам refresh-токен, а его SHA-256 хеш (таблица sessions):
 * утечка базы не позволяет войти под пользователем. Каждое обращение к
 * /auth/refresh отзывает старую сессию и выдаёт новую — ротация токенов,
 * повторное использование украденного refresh-токена не сработает.
 *
 * В payload токена кладём только id, роль и версию токенов — никаких
 * персональных данных: JWT не шифруется, его payload читается кем угодно.
 */

const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../config/env');
const { Session } = require('../models/session.model');
const { randomToken, sha256 } = require('../utils/password');
const { logger, logSuspicious, clientIp } = require('../utils/logger');

const REFRESH_COOKIE = 'refreshToken';

/** Параметры httpOnly cookie для refresh-токена. */
function refreshCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,                  // недоступна из document.cookie → защита при XSS
    secure: config.isProduction,     // только по HTTPS в production
    sameSite: 'strict',              // cookie не уйдёт при запросе с чужого origin → анти-CSRF
    path: '/',
    maxAge: maxAgeMs,
  };
}

/** Перевод «7d» / «15m» в миллисекунды. */
function ttlToMs(ttl) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(ttl).trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return value * unit;
}

/** Короткоживущий access-токен. */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, tv: user.tokenVersion, type: 'access' },
    config.jwt.secret,
    {
      expiresIn: config.jwt.accessTtl,
      issuer: config.jwt.issuer,
      algorithm: 'HS256',
    },
  );
}

/** Проверка access-токена. Бросает ошибку jsonwebtoken при любой проблеме. */
function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    // Жёстко фиксируем алгоритм: иначе возможна атака подменой alg на "none"
    algorithms: ['HS256'],
  });
  if (payload.type !== 'access') {
    throw new jwt.JsonWebTokenError('Ожидался access-токен');
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwt.refreshSecret, {
    issuer: config.jwt.issuer,
    algorithms: ['HS256'],
  });
  if (payload.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Ожидался refresh-токен');
  }
  return payload;
}

/**
 * Мера №20. Оставляем не больше maxSessionsPerUser активных сессий:
 * самые старые отзываются, пользователь на «лишнем» устройстве
 * будет разлогинен при следующем обновлении токена.
 */
async function enforceSessionLimit(userId, req) {
  const limit = config.security.maxSessionsPerUser;
  const active = await Session.findAll({
    where: { userId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    order: [['createdAt', 'ASC']],
  });

  if (active.length < limit) return;

  const excess = active.slice(0, active.length - limit + 1);
  await Promise.all(excess.map((session) => session.update({ revokedAt: new Date() })));

  logSuspicious('SESSION_LIMIT_EXCEEDED', req, {
    userId,
    limit,
    revokedSessions: excess.length,
  });
}

/**
 * Создаёт пару токенов и записывает сессию.
 * @returns {{accessToken: string, refreshToken: string, sessionId: string, expiresAt: Date}}
 */
async function issueTokenPair(user, req) {
  await enforceSessionLimit(user.id, req);

  const refreshTtlMs = ttlToMs(config.jwt.refreshTtl);
  const expiresAt = new Date(Date.now() + refreshTtlMs);

  // jti — случайная часть, делает каждый refresh-токен уникальным
  const jti = randomToken(16);
  const refreshToken = jwt.sign(
    { sub: user.id, tv: user.tokenVersion, jti, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshTtl, issuer: config.jwt.issuer, algorithm: 'HS256' },
  );

  const session = await Session.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    expiresAt,
    ip: clientIp(req),
    userAgent: (req.get && req.get('user-agent') || '').slice(0, 255),
  });

  return {
    accessToken: signAccessToken(user),
    refreshToken,
    sessionId: session.id,
    expiresAt,
    refreshTtlMs,
  };
}

/**
 * Проверяет refresh-токен и соответствующую запись в sessions.
 * @returns {Promise<Session>} активная сессия
 */
async function findActiveSession(refreshToken) {
  const session = await Session.findOne({ where: { tokenHash: sha256(refreshToken) } });
  if (!session) return null;
  if (!session.isActive()) return null;
  return session;
}

/** Отзыв одной сессии. */
async function revokeSession(session) {
  if (session && !session.revokedAt) {
    await session.update({ revokedAt: new Date() });
  }
}

/** Отзыв всех сессий пользователя (смена пароля, блокировка, logout-all). */
async function revokeAllSessions(userId) {
  const [count] = await Session.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null } },
  );
  if (count > 0) logger.info(`Отозвано сессий пользователя ${userId}: ${count}`);
  return count;
}

module.exports = {
  REFRESH_COOKIE,
  refreshCookieOptions,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokenPair,
  findActiveSession,
  revokeSession,
  revokeAllSessions,
  ttlToMs,
};
