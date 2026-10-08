'use strict';

/**
 * Модель пользователя.
 *
 * Поля по заданию: id, email (уникальный), passwordHash, role, createdAt, updatedAt.
 * Дополнительные поля обслуживают выбранные меры безопасности:
 *   failedAttempts, lockUntil          — мера №6 (блокировка после 5 неудач на 15 минут)
 *   resetTokenHash, resetTokenExpires  — мера №16 (временный токен сброса пароля, 1 час)
 *   tokenVersion                       — мгновенный отзыв всех выданных токенов
 *
 * Пароль в открытом виде не хранится и не логируется НИКОГДА — только bcrypt-хеш.
 * Второй уровень валидации (помимо Joi) — встроенные валидаторы Sequelize ниже.
 */

const { DataTypes, Model } = require('sequelize');

const ROLES = ['user', 'moderator', 'admin'];

/** Иерархия ролей: число = уровень полномочий, используется в roleGuard. */
const ROLE_LEVEL = { user: 1, moderator: 2, admin: 3 };

class User extends Model {
  /** Аккаунт заблокирован за перебор пароля? (мера №6) */
  isLocked() {
    return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
  }

  /** Сколько секунд осталось до разблокировки. */
  lockSecondsLeft() {
    if (!this.isLocked()) return 0;
    return Math.ceil((this.lockUntil.getTime() - Date.now()) / 1000);
  }

  hasAtLeastRole(role) {
    return (ROLE_LEVEL[this.role] || 0) >= (ROLE_LEVEL[role] || 99);
  }

  /**
   * Переопределённый toJSON: даже если объект случайно отдать через res.json(),
   * хеш пароля и служебные токены наружу не уйдут (защита от утечки данных).
   */
  toJSON() {
    const values = { ...this.get() };
    delete values.passwordHash;
    delete values.resetTokenHash;
    delete values.resetTokenExpires;
    delete values.tokenVersion;
    delete values.failedAttempts;
    delete values.lockUntil;
    return values;
  }

  /** Публичное представление для /auth/me и списка пользователей. */
  toPublicJSON() {
    return {
      id: this.id,
      email: this.email,
      role: this.role,
      isLocked: this.isLocked(),
      lastLoginAt: this.lastLoginAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

function initUser(sequelize) {
  User.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      // UUID вместо автоинкремента: нельзя перебрать пользователей по id 1,2,3...
    },
    email: {
      type: DataTypes.STRING(254),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: { msg: 'Некорректный формат email' },
        len: { args: [5, 254], msg: 'Email должен быть от 5 до 254 символов' },
      },
      set(value) {
        // Нормализация: email нечувствителен к регистру, иначе получим дубликаты
        this.setDataValue('email', typeof value === 'string' ? value.trim().toLowerCase() : value);
      },
    },
    passwordHash: {
      type: DataTypes.STRING(72),
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...ROLES),
      allowNull: false,
      defaultValue: 'user',
      validate: { isIn: { args: [ROLES], msg: `Роль должна быть одной из: ${ROLES.join(', ')}` } },
    },
    // ── мера №6: ограничение попыток входа ──────────────────────────────────
    failedAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lockUntil: { type: DataTypes.DATE, allowNull: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    // ── мера №16: временный токен сброса пароля ─────────────────────────────
    resetTokenHash: { type: DataTypes.STRING(64), allowNull: true },
    resetTokenExpires: { type: DataTypes.DATE, allowNull: true },
    // Увеличение версии инвалидирует все ранее выданные access-токены
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
    indexes: [{ unique: true, fields: ['email'] }],
  });

  return User;
}

module.exports = { User, initUser, ROLES, ROLE_LEVEL };
