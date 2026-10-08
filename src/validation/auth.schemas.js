'use strict';

/** Joi-схемы эндпоинтов аутентификации. */

const { Joi, email, password } = require('./common');

// POST /auth/register
// Поля role и id в схеме ОТСУТСТВУЮТ сознательно: роль назначает только
// администратор через PATCH /api/users/:id/role. Присланное клиентом
// "role": "admin" отклоняется валидатором с 400 (мера №9, mass assignment).
const register = Joi.object({
  email: email.required(),
  password: password.required(),
  passwordConfirm: Joi.string()
    .valid(Joi.ref('password'))
    .messages({ 'any.only': 'Пароли не совпадают' }),
});

// POST /auth/login
const login = Joi.object({
  email: Joi.string().trim().lowercase().max(254).required()
    .messages({ 'any.required': 'Поле "email" обязательно' }),
  // На входе пароль НЕ проверяем на сложность: иначе по тексту ошибки
  // можно было бы отличать «пароль слабый» от «пароль неверный».
  password: Joi.string().max(128).required()
    .messages({ 'any.required': 'Поле "password" обязательно' }),
});

// POST /auth/forgot-password (мера №16)
const forgotPassword = Joi.object({
  email: email.required(),
});

// POST /auth/reset-password (мера №16)
const resetPassword = Joi.object({
  token: Joi.string().hex().length(96).required()
    .messages({ 'any.required': 'Поле "token" обязательно' }),
  password: password.required(),
});

// POST /auth/change-password
const changePassword = Joi.object({
  currentPassword: Joi.string().max(128).required(),
  newPassword: password.required(),
});

module.exports = { register, login, forgotPassword, resetPassword, changePassword };
