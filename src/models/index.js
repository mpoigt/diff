'use strict';

const { Op, literal } = require('sequelize');

/**
 * Регистрация моделей, связей и первичное наполнение БД.
 */

const { sequelize } = require('../config/db');
const { User, initUser, ROLES, ROLE_LEVEL } = require('./user.model');
const { Diff, initDiff, MAX_TITLE, MAX_CONTENT } = require('./diff.model');
const { Session, initSession } = require('./session.model');
const { AuditLog, initAuditLog } = require('./auditLog.model');
const { computeStoredDiff, DIFF_ALGORITHM_VERSION } = require('../utils/diffEngine');
const { slugify } = require('../utils/slug');
const { hashPassword } = require('../utils/password');
const { logger } = require('../utils/logger');
const config = require('../config/env');

initUser(sequelize);
initDiff(sequelize);
initSession(sequelize);
initAuditLog(sequelize);

// ── Связи ────────────────────────────────────────────────────────────────────
// Удаление пользователя обнуляет владельца его сравнений (SET NULL),
// но сами сравнения остаются — это история, её нельзя терять.
User.hasMany(Diff, { foreignKey: 'ownerId', as: 'diffs', onDelete: 'SET NULL' });
Diff.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// Сессии живут только вместе с пользователем.
User.hasMany(Session, { foreignKey: 'userId', as: 'sessions', onDelete: 'CASCADE' });
Session.belongsTo(User, { foreignKey: 'userId', as: 'user' });

AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor', constraints: false });

/** Создание/обновление схемы. alter — только для разработки. */
async function sync() {
  await sequelize.sync({ alter: config.db.syncAlter });
  logger.info(`Схема БД синхронизирована (alter=${config.db.syncAlter})`);
}

/**
 * Стартовый администратор.
 * Берётся из .env (ADMIN_EMAIL/ADMIN_PASSWORD) — в коде нет захардкоженных
 * учётных данных. Если переменные не заданы, админ просто не создаётся.
 */
async function ensureAdmin() {
  const { email, password } = config.bootstrapAdmin;
  if (!email || !password) {
    logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD не заданы — стартовый администратор не создан');
    return;
  }

  const existing = await User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      logger.info(`Пользователю ${email} возвращена роль admin`);
    }
    return;
  }

  await User.create({
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
  });
  logger.info(`Создан стартовый администратор: ${email}`);
}

/** Демонстрационные записи, чтобы GET /api/diffs не был пустым при первом запуске. */
async function seedDiffs() {
  if (await Diff.count() > 0) return;

  const samples = [
    {
      title: 'README: правки перед релизом',
      author: 'system',
      fileAName: 'README.old.md',
      fileAContent: '# Diff Service\nВерсия 0.9\nЗапуск: node server.js\nTODO: описать API',
      fileBName: 'README.new.md',
      fileBContent: '# Diff Service\nВерсия 1.0\nЗапуск: npm run dev\nTODO: описать API\nЛицензия: ISC',
    },
    {
      title: 'config.json: смена порта',
      author: 'system',
      fileAName: 'config.old.json',
      fileAContent: '{\n  "port": 3000,\n  "debug": true\n}',
      fileBName: 'config.new.json',
      fileBContent: '{\n  "port": 8080,\n  "debug": false\n}',
    },
  ];

  for (const sample of samples) {
    const { changes, stats } = computeStoredDiff(sample.fileAContent, sample.fileBContent);
    // slug у демо-записей строится из заголовка — тем же способом,
    // что и в контроллере при создании через API
    // eslint-disable-next-line no-await-in-loop
    await Diff.create({
      ...sample, slug: slugify(sample.title), changes, stats,
    });
  }
  logger.info('Добавлены демонстрационные сравнения');
}

/** Пересчитывает старые результаты, сохраняя содержимое файлов и дату записи. */
async function refreshStoredDiffs() {
  const stale = literal(`"stats"->>'algorithmVersion' IS DISTINCT FROM '${DIFF_ALGORITHM_VERSION}'`);
  const hasTrailingWhitespace = /[ \t]+(?:\r?\n|$)/;
  let lastId;
  let updated = 0;

  for (;;) {
    const rows = await Diff.findAll({
      attributes: ['id', 'fileAContent', 'fileBContent', 'stats'],
      where: { ...(lastId ? { id: { [Op.gt]: lastId } } : {}), [Op.and]: [stale] },
      order: [['id', 'ASC']],
      limit: 50,
      raw: true,
    });
    if (rows.length === 0) break;

    for (const { id, fileAContent, fileBContent, stats } of rows) {
      const derived = hasTrailingWhitespace.test(fileAContent) || hasTrailingWhitespace.test(fileBContent)
        ? computeStoredDiff(fileAContent, fileBContent)
        : { stats: { ...stats, algorithmVersion: DIFF_ALGORITHM_VERSION } };
      const [count] = await Diff.update(derived, {
        where: { id, fileAContent, fileBContent, [Op.and]: [stale] },
        silent: true,
      });
      updated += count;
    }
    lastId = rows.at(-1).id;
  }

  if (updated > 0) logger.info('Обновлены результаты сохранённых сравнений', { updated });
}

/** Чистка просроченных/отозванных сессий — вызывается на старте. */
async function cleanupSessions() {
  const removed = await Session.destroy({
    where: { expiresAt: { [Op.lt]: new Date() } },
  });
  if (removed > 0) logger.info(`Удалено просроченных сессий: ${removed}`);
}

async function bootstrap() {
  await sync();
  await refreshStoredDiffs();
  await ensureAdmin();
  await seedDiffs();
  await cleanupSessions();
}

module.exports = {
  sequelize,
  User,
  Diff,
  Session,
  AuditLog,
  ROLES,
  ROLE_LEVEL,
  MAX_TITLE,
  MAX_CONTENT,
  bootstrap,
};
