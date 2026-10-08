'use strict';

/**
 * Мера №7 — audit log действий администратора.
 *
 * Middleware навешивается на административные маршруты. Он не мешает
 * обработке запроса: подписывается на событие 'finish' ответа и уже
 * ПОСЛЕ отправки ответа пишет запись — кто, что, над чем, откуда,
 * с каким HTTP-статусом. Так в журнал попадают и неудачные попытки
 * (403/404), что для аудита даже важнее успешных.
 *
 * Запись дублируется в двух местах:
 *   1. таблица audit_logs (доступна через GET /api/admin/audit-log);
 *   2. файл logs/audit-YYYY-MM-DD.log с ротацией — останется, даже если
 *      запись в БД не удалась.
 */

const { AuditLog } = require('../models/auditLog.model');
const { auditLogger, clientIp } = require('../utils/logger');

/**
 * @param {string} action     код действия, например USER_ROLE_CHANGED
 * @param {object} [options]
 * @param {string} [options.targetType]
 * @param {(req, res) => object} [options.metadata] дополнительные поля
 */
function audit(action, options = {}) {
  const { targetType = null, metadata = null } = options;

  return (req, res, next) => {
    res.on('finish', () => {
      const entry = {
        actorId: req.user?.id || null,
        actorEmail: req.user?.email || null,
        actorRole: req.user?.role || null,
        action,
        method: req.method,
        path: req.originalUrl.slice(0, 512),
        targetType,
        targetId: req.params?.id ? String(req.params.id) : null,
        statusCode: res.statusCode,
        ip: clientIp(req),
        userAgent: (req.get('user-agent') || '').slice(0, 255),
        metadata: (() => {
          try {
            return metadata ? metadata(req, res) : null;
          } catch {
            return null;
          }
        })(),
      };

      // Сначала файл (быстро и надёжно), затем БД
      auditLogger.info(action, entry);

      AuditLog.create(entry).catch((error) => {
        auditLogger.error('Не удалось записать audit log в БД', { action, reason: error.message });
      });
    });

    next();
  };
}

module.exports = audit;
