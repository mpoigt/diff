'use strict';

/**
 * Audit log — мера №7: журнал всех действий администратора (и модератора).
 *
 * Пишется в двух местах одновременно:
 *   - таблица audit_logs (можно смотреть через GET /api/admin/audit-log);
 *   - файл logs/audit-YYYY-MM-DD.log с ротацией (нужен, если БД недоступна).
 *
 * Запись создаётся ПОСЛЕ успешного выполнения действия и содержит
 * кто (actorId/actorEmail), что (action), над чем (targetType/targetId),
 * откуда (ip, userAgent) и с каким результатом (statusCode).
 */

const { DataTypes, Model } = require('sequelize');

class AuditLog extends Model {}

function initAuditLog(sequelize) {
  AuditLog.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    actorId: { type: DataTypes.UUID, allowNull: true },
    actorEmail: { type: DataTypes.STRING(254), allowNull: true },
    actorRole: { type: DataTypes.STRING(32), allowNull: true },
    action: { type: DataTypes.STRING(128), allowNull: false },
    method: { type: DataTypes.STRING(10), allowNull: true },
    path: { type: DataTypes.STRING(512), allowNull: true },
    targetType: { type: DataTypes.STRING(64), allowNull: true },
    targetId: { type: DataTypes.STRING(64), allowNull: true },
    statusCode: { type: DataTypes.INTEGER, allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: true },
  }, {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ['actorId'] }, { fields: ['action'] }, { fields: ['createdAt'] }],
  });

  return AuditLog;
}

module.exports = { AuditLog, initAuditLog };
