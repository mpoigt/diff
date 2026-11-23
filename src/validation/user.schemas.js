'use strict';

/** Joi-схемы администрирования пользователей. */

const { Joi, pagination } = require('./common');
const { ROLES } = require('../models/user.model');

// PATCH /api/users/:id/role — единственное изменяемое поле, только для admin
const updateRole = Joi.object({
  role: Joi.string().valid(...ROLES).required()
    .messages({
      'any.only': `Роль должна быть одной из: ${ROLES.join(', ')}`,
      'any.required': 'Поле "role" обязательно',
    }),
});

const listUsersQuery = Joi.object({
  role: Joi.string().valid(...ROLES),
  search: Joi.string().trim().max(254).allow(''),
  ...pagination,
});

const auditQuery = Joi.object({
  action: Joi.string().trim().max(128),
  actorId: Joi.string().uuid({ version: 'uuidv4' }),
  ...pagination,
});

module.exports = { updateRole, listUsersQuery, auditQuery };
