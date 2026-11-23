'use strict';

/**
 * Активная сессия пользователя = один выданный refresh-токен.
 *
 * Обслуживает две меры:
 *   №5  — refresh-токен в httpOnly cookie: сам токен в БД не хранится,
 *         хранится только его SHA-256 хеш, как и пароль;
 *   №20 — ограничение числа одновременных сессий на пользователя:
 *         при превышении MAX_SESSIONS_PER_USER самая старая сессия отзывается.
 */

const { DataTypes, Model } = require('sequelize');

class Session extends Model {
  isActive() {
    return !this.revokedAt && this.expiresAt.getTime() > Date.now();
  }

  toPublicJSON() {
    return {
      id: this.id,
      ip: this.ip,
      userAgent: this.userAgent,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      revokedAt: this.revokedAt,
      active: this.isActive(),
    };
  }
}

function initSession(sequelize) {
  Session.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: { type: DataTypes.UUID, allowNull: false },
    // SHA-256 от refresh-токена: утечка таблицы не даёт возможности войти
    tokenHash: { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
  }, {
    sequelize,
    modelName: 'Session',
    tableName: 'sessions',
    timestamps: true,
    indexes: [{ fields: ['userId'] }, { unique: true, fields: ['tokenHash'] }],
  });

  return Session;
}

module.exports = { Session, initSession };
