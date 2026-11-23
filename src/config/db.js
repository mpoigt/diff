'use strict';

/**
 * Подключение к PostgreSQL через ORM Sequelize.
 *
 * Зачем ORM, а не ручная склейка SQL: Sequelize формирует только
 * ПАРАМЕТРИЗОВАННЫЕ запросы (значения уходят в драйвер pg отдельно от текста
 * запроса в виде $1, $2, ...). Поэтому строка вида  ' OR 1=1 --  попадает в БД
 * как обычный текст и не может изменить структуру запроса —
 * это и есть защита от SQL-инъекций (OWASP A03:2021 Injection).
 */

const { Sequelize } = require('sequelize');
const config = require('./env');
const { logger } = require('../utils/logger');

const common = {
  dialect: 'postgres',
  // SQL в консоль только в разработке: в production запросы могут содержать данные пользователей
  logging: config.isProduction ? false : (sql) => logger.debug(sql),
  define: {
    underscored: false,
    freezeTableName: false,
  },
  pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
  dialectOptions: config.db.ssl
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
};

const sequelize = config.db.url
  ? new Sequelize(config.db.url, common)
  : new Sequelize(config.db.name, config.db.user, config.db.password, {
    ...common,
    host: config.db.host,
    port: config.db.port,
  });

/** Проверка соединения — вызывается на старте, чтобы не поднимать сервер «вслепую». */
async function connect() {
  await sequelize.authenticate();
  logger.info('PostgreSQL: соединение установлено');
}

module.exports = { sequelize, connect, Sequelize };
