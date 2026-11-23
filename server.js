'use strict';

/**
 * Точка входа.
 *
 * Сервер поднимается только ПОСЛЕ успешного подключения к PostgreSQL
 * и синхронизации схемы: иначе первые запросы падали бы с 500,
 * а пользователь видел бы невнятную ошибку.
 *
 * Отдельно перехватываются unhandledRejection и uncaughtException:
 * такие ошибки пишутся в лог-файл (logs/error-*.log) и процесс
 * завершается корректно, а не остаётся в неопределённом состоянии.
 */

const config = require('./src/config/env');
const app = require('./src/app');
const { connect, sequelize } = require('./src/config/db');
const { bootstrap } = require('./src/models');
const { logger, errorLogger } = require('./src/utils/logger');
const { reportError, flushErrors, sendOperationalLog } = require('./src/services/telemetry');

let server;

async function start() {
  try {
    await connect();
    await bootstrap();
  } catch (error) {
    // Самая частая причина — не заполнен DATABASE_URL в .env
    logger.error('Не удалось подключиться к базе данных', {
      event: 'DATABASE_CONNECTION_FAILED',
      ...(config.isProduction ? {} : { reason: error.message }),
    });
    logger.error('Проверьте DATABASE_URL в .env (см. .env.example) и что PostgreSQL запущен');
    reportError(error, { source: 'startup' });
    await Promise.all([flushErrors(), sendOperationalLog('server.startup.failed')]);
    process.exit(1);
  }

  server = app.listen(config.port, config.host, () => {
    logger.info(`Сервер запущен на порту ${config.port} [${config.nodeEnv}]`, { event: 'SERVER_STARTED' });
    logger.info(`API:            http://localhost:${config.port}/api`);
    logger.info(`Демо-страница:  http://localhost:${config.port}/`);
    void sendOperationalLog('server.started');
    if (!config.isProduction) {
      logger.warn('NODE_ENV=development: ответы 500 содержат отладочную информацию (devMessage/devStack)');
    }
  });
}

/** Корректное завершение: закрываем HTTP-сервер, затем пул соединений с БД. */
async function shutdown(signal) {
  logger.info(`${signal}: остановка сервера...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await sequelize.close().catch(() => {});
  await flushErrors();
  logger.info('Сервер остановлен');
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => { shutdown(signal); });
});

process.on('unhandledRejection', (reason) => {
  reportError(reason, { source: 'unhandledRejection' });
  errorLogger.error('Необработанное отклонение promise', config.isProduction ? {} : {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', async (error) => {
  reportError(error, { source: 'uncaughtException' });
  errorLogger.error('Необработанное исключение', config.isProduction ? {} : { reason: error.message, stack: error.stack });
  await flushErrors();
  process.exit(1);
});

start();
