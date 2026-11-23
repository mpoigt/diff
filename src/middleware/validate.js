'use strict';

/**
 * Универсальный валидатор на базе Joi.
 *
 * Используется на ВСЕХ эндпоинтах, принимающих данные: тело, параметры пути
 * и строку запроса. Ключевые опции:
 *
 *   abortEarly: false  — вернуть пользователю сразу все ошибки, а не первую;
 *   allowUnknown: false — неизвестное поле = ошибка 400. Именно это закрывает
 *                         массовое присвоение (мера №9): клиент не может
 *                         подсунуть "role":"admin" или "ownerId";
 *   convert: true      — "limit=5" из query приводится к числу 5;
 *   stripUnknown: false — не вырезаем молча, а явно сообщаем об ошибке.
 *
 * Валидированное (и приведённое к типам) значение заменяет исходное:
 * дальше в контроллер попадают только проверенные данные.
 */

const ApiError = require('./ApiError');
const { logSuspicious } = require('../utils/logger');

// Локализация системных сообщений Joi
const MESSAGES = {
  'object.unknown': 'Поле {{#label}} недопустимо для этого запроса',
  'object.base': 'Тело запроса должно быть JSON-объектом',
  'string.base': 'Поле {{#label}} должно быть строкой',
  'number.base': 'Поле {{#label}} должно быть числом',
  'boolean.base': 'Поле {{#label}} должно быть true или false',
  'any.required': 'Поле {{#label}} обязательно',
  'any.only': 'Поле {{#label}} имеет недопустимое значение',
  'number.min': 'Поле {{#label}} должно быть не меньше {{#limit}}',
  'number.max': 'Поле {{#label}} должно быть не больше {{#limit}}',
  'number.integer': 'Поле {{#label}} должно быть целым числом',
};

const OPTIONS = {
  abortEarly: false,
  allowUnknown: false,
  stripUnknown: false,
  convert: true,
  messages: MESSAGES,
};

/**
 * @param {import('joi').Schema} schema
 * @param {'body'|'params'|'query'} source
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { value, error } = schema.validate(req[source], OPTIONS);

    if (error) {
      const details = error.details.map((d) => d.message);

      // Попытка подсунуть служебное поле — не просто ошибка ввода,
      // а признак целенаправленной атаки. Фиксируем в security-логе.
      const forbidden = error.details
        .filter((d) => d.type === 'object.unknown')
        .map((d) => d.path.join('.'));
      if (forbidden.length > 0) {
        logSuspicious('MASS_ASSIGNMENT_ATTEMPT', req, { source, fields: forbidden });
      }

      return next(ApiError.badRequest('Некорректные данные запроса', details));
    }

    req[source] = value;
    return next();
  };
}

module.exports = validate;
