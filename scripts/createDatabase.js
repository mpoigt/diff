'use strict';

/**
 * Создание базы данных, если её ещё нет: `npm run db:create`.
 *
 * Подключается к служебной БД postgres теми же учётными данными из .env
 * и выполняет CREATE DATABASE. Имя БД подставляется через
 * экранирование идентификатора (двойные кавычки + удвоение кавычек внутри),
 * потому что CREATE DATABASE не принимает параметры-плейсхолдеры.
 */

const { Client } = require('pg');
const config = require('../src/config/env');

/** Экранирование идентификатора PostgreSQL. */
function quoteIdent(name) {
  if (!/^[A-Za-z0-9_$]+$/.test(name)) {
    throw new Error(`Недопустимое имя базы данных: "${name}". Разрешены буквы, цифры, _ и $`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

function connectionConfig() {
  if (config.db.url) {
    // Берём DSN, но подменяем имя БД на служебную postgres
    const url = new URL(config.db.url);
    const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')) || config.db.name;
    url.pathname = '/postgres';
    return { connectionString: url.toString(), dbName };
  }
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: 'postgres',
    dbName: config.db.name,
  };
}

async function main() {
  const { dbName, ...clientOptions } = connectionConfig();
  const client = new Client(clientOptions);

  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );

    if (rowCount > 0) {
      console.log(`База данных "${dbName}" уже существует — ничего делать не нужно.`);
      return;
    }

    await client.query(`CREATE DATABASE ${quoteIdent(dbName)} ENCODING 'UTF8'`);
    console.log(`База данных "${dbName}" создана.`);
    console.log('Теперь запустите сервер: npm run dev');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Не удалось создать базу данных:', error.message);
  console.error('Проверьте DATABASE_URL / DB_USER / DB_PASSWORD в .env и что PostgreSQL запущен.');
  process.exit(1);
});
