'use strict';

const { computeDiff } = require('../utils/diffEngine');

/**
 * "Модель" данных. По условию лабораторной работы хранилище — обычный массив
 * в памяти процесса. Слой намеренно изолирован, чтобы в следующей работе
 * заменить его на реальную БД, не трогая контроллеры и маршруты.
 */
const diffs = [];
let lastId = 0;

function nextId() {
  lastId += 1;
  return String(lastId);
}

function findAll({ search, author, onlyChanged } = {}) {
  let result = diffs;

  if (search) {
    const needle = String(search).toLowerCase();
    result = result.filter((d) => d.title.toLowerCase().includes(needle)
      || d.fileA.name.toLowerCase().includes(needle)
      || d.fileB.name.toLowerCase().includes(needle));
  }

  if (author) {
    const needle = String(author).toLowerCase();
    result = result.filter((d) => d.author.toLowerCase() === needle);
  }

  if (onlyChanged) {
    result = result.filter((d) => !d.stats.identical);
  }

  return result;
}

function findById(id) {
  return diffs.find((d) => d.id === String(id));
}

function create({ title, author, fileA, fileB }) {
  const { changes, stats } = computeDiff(fileA.content, fileB.content);
  const now = new Date().toISOString();

  const diff = {
    id: nextId(),
    title,
    author: author || 'anonymous',
    fileA: { name: fileA.name, content: fileA.content },
    fileB: { name: fileB.name, content: fileB.content },
    stats,
    changes,
    createdAt: now,
    updatedAt: now,
  };

  diffs.push(diff);
  return diff;
}

/** Полная замена ресурса (PUT): пересчитываем diff заново. */
function replace(id, { title, author, fileA, fileB }) {
  const index = diffs.findIndex((d) => d.id === String(id));
  if (index === -1) return null;

  const { changes, stats } = computeDiff(fileA.content, fileB.content);

  const updated = {
    ...diffs[index],
    title,
    author: author || 'anonymous',
    fileA: { name: fileA.name, content: fileA.content },
    fileB: { name: fileB.name, content: fileB.content },
    stats,
    changes,
    updatedAt: new Date().toISOString(),
  };

  diffs[index] = updated;
  return updated;
}

/** Частичное обновление (PATCH): перерасчёт только если менялось содержимое файлов. */
function update(id, patch) {
  const index = diffs.findIndex((d) => d.id === String(id));
  if (index === -1) return null;

  const current = diffs[index];
  const updated = {
    ...current,
    title: patch.title !== undefined ? patch.title : current.title,
    author: patch.author !== undefined ? patch.author : current.author,
    fileA: patch.fileA ? { ...current.fileA, ...patch.fileA } : current.fileA,
    fileB: patch.fileB ? { ...current.fileB, ...patch.fileB } : current.fileB,
    updatedAt: new Date().toISOString(),
  };

  if (patch.fileA || patch.fileB) {
    const { changes, stats } = computeDiff(updated.fileA.content, updated.fileB.content);
    updated.changes = changes;
    updated.stats = stats;
  }

  diffs[index] = updated;
  return updated;
}

function remove(id) {
  const index = diffs.findIndex((d) => d.id === String(id));
  if (index === -1) return null;
  return diffs.splice(index, 1)[0];
}

function count() {
  return diffs.length;
}

/** Демонстрационные данные, чтобы GET /api/diffs не был пустым при старте. */
function seed() {
  if (diffs.length > 0) return;

  create({
    title: 'README: правки перед релизом',
    author: 'student',
    fileA: {
      name: 'README.old.md',
      content: '# Diff Service\nВерсия 0.9\nЗапуск: node server.js\nTODO: описать API',
    },
    fileB: {
      name: 'README.new.md',
      content: '# Diff Service\nВерсия 1.0\nЗапуск: npm run dev\nTODO: описать API\nЛицензия: ISC',
    },
  });

  create({
    title: 'config.json: смена порта',
    author: 'student',
    fileA: { name: 'config.old.json', content: '{\n  "port": 3000,\n  "debug": true\n}' },
    fileB: { name: 'config.new.json', content: '{\n  "port": 8080,\n  "debug": false\n}' },
  });
}

module.exports = { findAll, findById, create, replace, update, remove, count, seed };
