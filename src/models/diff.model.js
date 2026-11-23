'use strict';

/**
 * Основная сущность курсового проекта — сравнение двух файлов (diff).
 *
 * До этой работы данные жили в массиве в памяти; теперь это таблица PostgreSQL,
 * а все обращения идут через Sequelize (параметризованные запросы).
 * Контроллеры при этом не поменяли форму ответа: метод toApiJSON() собирает
 * ту же структуру { fileA: {name, content}, ... }, что отдавалась раньше,
 * поэтому фронтенд и старая коллекция запросов продолжают работать.
 */

const { DataTypes, Model } = require('sequelize');
const { SLUG_PATTERN, MAX_SLUG } = require('../utils/slug');

const MAX_TITLE = 120;
const MAX_CONTENT = 100 * 1024; // 100 КБ на файл

class Diff extends Model {
  toStatsJSON() {
    const { algorithmVersion, ...stats } = this.stats;
    return stats;
  }

  /** Представление для API: вложенные объекты fileA/fileB вместо плоских колонок. */
  toApiJSON({ includeChanges = true } = {}) {
    const body = {
      id: this.id,
      slug: this.slug,
      title: this.title,
      author: this.author,
      ownerId: this.ownerId,
      fileA: { name: this.fileAName, content: this.fileAContent },
      fileB: { name: this.fileBName, content: this.fileBContent },
      stats: this.toStatsJSON(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
    if (includeChanges) body.changes = this.changes;
    return body;
  }

  /** Краткое представление для списка: без содержимого файлов и без changes. */
  toSummaryJSON() {
    return {
      id: this.id,
      slug: this.slug,
      title: this.title,
      author: this.author,
      ownerId: this.ownerId,
      fileA: { name: this.fileAName },
      fileB: { name: this.fileBName },
      stats: this.toStatsJSON(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

function initDiff(sequelize) {
  Diff.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Уникальное поле сущности (требование КР №1): человекочитаемый
    // идентификатор, по которому запись можно получить вместо UUID.
    // Генерируется из title, если клиент не задал его сам.
    slug: {
      type: DataTypes.STRING(MAX_SLUG),
      allowNull: false,
      unique: true,
      validate: {
        is: {
          args: SLUG_PATTERN,
          msg: 'slug может содержать только строчные латинские буквы, цифры и дефисы',
        },
        len: { args: [3, MAX_SLUG], msg: `slug должен быть от 3 до ${MAX_SLUG} символов` },
      },
    },
    title: {
      type: DataTypes.STRING(MAX_TITLE),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Заголовок не может быть пустым' },
        len: { args: [1, MAX_TITLE], msg: `Заголовок до ${MAX_TITLE} символов` },
      },
    },
    // Отображаемое имя автора. Кто владелец ресурса — определяет ownerId, а не это поле:
    // поле author пользователь задать не может (защита от mass assignment, мера №9).
    author: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: 'anonymous',
    },
    fileAName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { notEmpty: { msg: 'Имя файла A обязательно' } },
    },
    fileAContent: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { len: { args: [0, MAX_CONTENT], msg: `Файл A до ${MAX_CONTENT} символов` } },
    },
    fileBName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { notEmpty: { msg: 'Имя файла B обязательно' } },
    },
    fileBContent: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { len: { args: [0, MAX_CONTENT], msg: `Файл B до ${MAX_CONTENT} символов` } },
    },
    // Результат работы diffEngine. JSONB — нативный тип PostgreSQL,
    // значение уходит в БД параметром, инъекция через содержимое файла невозможна.
    stats: { type: DataTypes.JSONB, allowNull: false },
    changes: { type: DataTypes.JSONB, allowNull: false },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: true, // null — у демо-записей, созданных сидером
    },
  }, {
    sequelize,
    modelName: 'Diff',
    tableName: 'diffs',
    timestamps: true,
    indexes: [
      { fields: ['ownerId'] },
      { fields: ['author'] },
      { unique: true, fields: ['slug'] },
    ],
  });

  return Diff;
}

module.exports = { Diff, initDiff, MAX_TITLE, MAX_CONTENT, MAX_SLUG };
