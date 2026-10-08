'use strict';

/**
 * Логирование (winston + ротация файлов).
 *
 * Четыре независимых канала, чтобы разные сорта событий не смешивались:
 *   logger         — обычная работа приложения (консоль + logs/app-*.log)
 *   securityLogger — ПОДОЗРИТЕЛЬНЫЕ действия (logs/security-*.log)
 *   errorLogger    — только ошибки, отдельный файл с ротацией (мера №30)
 *   auditLogger    — действия администраторов, audit trail (мера №7)
 *
 * Ротация: новый файл каждый день, архивы жмутся в .gz, хранятся 14 дней,
 * размер одного файла ограничен 5 МБ — лог не съест диск.
 */

const path = require('path');
const fs = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const isProduction = process.env.NODE_ENV === 'production';

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...rest }) => {
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${extra}`;
  }),
);

/** Фабрика транспорта с ротацией. */
function rotateFile(name, level) {
  return new winston.transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: `${name}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '5m',
    maxFiles: '14d',
    level,
    format: jsonFormat,
  });
}

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: jsonFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    rotateFile('app', 'info'),
    // Мера №30: все ошибки дублируются в отдельный файл с ротацией
    rotateFile('error', 'error'),
  ],
});

const securityLogger = winston.createLogger({
  level: 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    rotateFile('security', 'info'),
  ],
});

const errorLogger = winston.createLogger({
  level: 'error',
  format: jsonFormat,
  transports: [rotateFile('error', 'error')],
});

const auditLogger = winston.createLogger({
  level: 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    rotateFile('audit', 'info'),
  ],
});

/** Реальный IP клиента с учётом прокси (app.set('trust proxy')). */
function clientIp(req) {
  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

/**
 * Запись о подозрительном действии.
 * @param {string} event      код события, например LOGIN_FAILED
 * @param {object} req        Express-запрос (может быть undefined)
 * @param {object} [details]  дополнительные поля
 */
function logSuspicious(event, req, details = {}) {
  securityLogger.warn(event, {
    event,
    ip: clientIp(req),
    method: req?.method,
    url: req?.originalUrl,
    userAgent: req?.get ? req.get('user-agent') : undefined,
    userId: req?.user?.id,
    userEmail: req?.user?.email,
    ...details,
  });
}

module.exports = {
  logger, securityLogger, errorLogger, auditLogger, logSuspicious, clientIp, LOG_DIR,
};
