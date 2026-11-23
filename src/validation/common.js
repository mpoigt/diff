'use strict';

/**
 * Общие строительные блоки Joi-схем.
 *
 * Важная деталь всех схем проекта: они объявлены СТРОГИМИ
 * (по умолчанию Joi запрещает неизвестные ключи при stripUnknown=false
 * и allowUnknown=false — см. middleware/validate.js).
 * Поэтому попытка прислать в теле запроса лишнее поле
 * (`"role": "admin"`, `"ownerId": "..."`, `"id": "..."`)
 * приводит к ошибке 400, а не к незаметному присвоению — это защита
 * от массового присвоения, mass assignment (мера №9, OWASP A08).
 */

const Joi = require('joi');
const { checkPasswordStrength, PASSWORD_RULE_TEXT } = require('../utils/password');

/** UUID v4 — формат всех идентификаторов в проекте. */
const uuid = Joi.string().uuid({ version: 'uuidv4' }).messages({
  'string.guid': 'Идентификатор должен быть корректным UUID',
});

/** :id в пути. */
const idParam = Joi.object({ id: uuid.required() });

/**
 * Email.
 * tlds.allow=false — не сверяем домен верхнего уровня со списком IANA,
 * чтобы работали учебные адреса вида admin@diffservice.local.
 */
const email = Joi.string()
  .trim()
  .lowercase()
  .max(254)
  .email({ minDomainSegments: 2, tlds: { allow: false } })
  .messages({
    'string.email': 'Некорректный формат email',
    'string.max': 'Email не должен превышать 254 символов',
    'any.required': 'Поле "email" обязательно',
  });

/**
 * Пароль: базовые ограничения Joi + политика сложности из utils/password
 * (мера №3). Сообщения об ошибках перечисляют все нарушенные правила сразу.
 */
const password = Joi.string()
  .min(8)
  .max(128)
  .custom((value, helpers) => {
    const errors = checkPasswordStrength(value);
    if (errors.length > 0) {
      return helpers.error('password.weak', { details: errors.join('; ') });
    }
    return value;
  })
  .messages({
    'string.min': 'Пароль должен содержать минимум 8 символов',
    'string.max': 'Пароль не должен превышать 128 символов',
    'password.weak': `Пароль не соответствует политике ({{#details}}). Требования: ${PASSWORD_RULE_TEXT}`,
    'any.required': 'Поле "password" обязательно',
  });

/** Пагинация для списков. */
const pagination = {
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
};

module.exports = { Joi, uuid, idParam, email, password, pagination };
