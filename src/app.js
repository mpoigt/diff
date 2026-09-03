'use strict';

const path = require('path');
const express = require('express');

const diffsRouter = require('./routes/diffs.routes');
const logger = require('./middleware/logger');
const cors = require('./middleware/cors');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const Diff = require('./models/diff.model');

const app = express();

// --- Middleware ---------------------------------------------------------
app.use(logger);
app.use(cors);
app.use(express.json({ limit: '1mb' }));              // парсинг application/json
app.use(express.urlencoded({ extended: true }));      // парсинг форм
app.use(express.static(path.join(__dirname, '..', 'public'))); // демо-страница

// --- Демонстрационные данные -------------------------------------------
Diff.seed();

// --- Служебные маршруты -------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), diffs: Diff.count() });
});

app.get('/api', (req, res) => {
  res.json({
    service: 'Diff Service API',
    version: '1.0.0',
    endpoints: [
      'GET    /api/diffs',
      'GET    /api/diffs/:id',
      'GET    /api/diffs/:id/patch',
      'POST   /api/diffs',
      'PUT    /api/diffs/:id',
      'PATCH  /api/diffs/:id',
      'DELETE /api/diffs/:id',
    ],
  });
});

// --- Основной ресурс ----------------------------------------------------
app.use('/api/diffs', diffsRouter);

// --- Обработка ошибок (всегда последними) -------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
