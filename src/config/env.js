'use strict';

/**
 * Единая точка чтения переменных окружения.
 *
 * Все секреты (пароль БД, секреты JWT) берутся только из .env и никогда
 * не попадают в репозиторий: .env в .gitignore, в Git лежит лишь .env.example.
 * Если обязательная переменная не задана или слишком слабая — процесс падает
 * на старте, а не в середине обработки запроса.
 */

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Переменная окружения ${name} не задана. Скопируйте .env.example в .env и заполните его.`);
  }
  return value.trim();
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Переменная окружения ${name} должна быть числом, получено "${raw}"`);
  }
  return value;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Секреты JWT короче 32 символов легко перебираются — не даём запуститься.
const jwtSecret = required('JWT_SECRET');
const jwtRefreshSecret = required('JWT_REFRESH_SECRET');
if (jwtSecret.length < 32 || jwtRefreshSecret.length < 32) {
  throw new Error('JWT_SECRET и JWT_REFRESH_SECRET должны быть не короче 32 символов');
}
if (jwtSecret === jwtRefreshSecret) {
  throw new Error('JWT_SECRET и JWT_REFRESH_SECRET должны различаться');
}

const config = {
  nodeEnv,
  isProduction,
  port: num('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  trustedProxies: list('TRUSTED_PROXIES', []),

  telemetry: {
    sentryDsn: process.env.SENTRY_DSN || null,
    logsUrl: process.env.BETTER_STACK_LOGS_URL || null,
    logsToken: process.env.BETTER_STACK_SOURCE_TOKEN || null,
  },

  db: {
    url: process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== ''
      ? process.env.DATABASE_URL.trim()
      : null,
    host: process.env.DB_HOST || 'localhost',
    port: num('DB_PORT', 5432),
    name: process.env.DB_NAME || 'diff_service',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: bool('DB_SSL', false),
    syncAlter: bool('DB_SYNC_ALTER', !isProduction),
  },

  jwt: {
    secret: jwtSecret,
    refreshSecret: jwtRefreshSecret,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    issuer: 'diff-service-api',
  },

  security: {
    bcryptRounds: num('BCRYPT_ROUNDS', 12),
    loginMaxAttempts: num('LOGIN_MAX_ATTEMPTS', 5),
    loginLockMinutes: num('LOGIN_LOCK_MINUTES', 15),
    maxSessionsPerUser: num('MAX_SESSIONS_PER_USER', 3),
    bodyLimit: process.env.BODY_LIMIT || '100kb',
    corsWhitelist: list('CORS_WHITELIST', ['http://localhost:3000', 'http://127.0.0.1:3000']),
    resetTokenTtlMinutes: num('RESET_TOKEN_TTL_MINUTES', 60),
    rateLimitWindowMinutes: num('RATE_LIMIT_WINDOW_MINUTES', 15),
    rateLimitMax: num('RATE_LIMIT_MAX', 300),
    authRateLimitMax: num('AUTH_RATE_LIMIT_MAX', 10),
    userRateLimitMax: num('USER_RATE_LIMIT_MAX', 60),
  },

  bootstrapAdmin: {
    email: process.env.ADMIN_EMAIL || null,
    password: process.env.ADMIN_PASSWORD || null,
  },
};

module.exports = config;
