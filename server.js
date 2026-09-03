'use strict';

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API:  http://localhost:${PORT}/api/diffs`);
  console.log(`Демо: http://localhost:${PORT}/`);
});

// Аккуратное завершение (Ctrl+C / перезапуск nodemon)
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    console.log(`\n${signal}: остановка сервера...`);
    server.close(() => process.exit(0));
  });
});
