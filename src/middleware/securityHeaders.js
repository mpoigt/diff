'use strict';

/**
 * Заголовки безопасности (helmet) — обязательная мера задания,
 * а также меры №13 (CSP) и №18 (X-Frame-Options: DENY).
 *
 * Что именно ставит helmet и зачем:
 *   Content-Security-Policy        — мера №13. Браузер исполняет только те
 *                                    скрипты и стили, что пришли с нашего
 *                                    origin ('self'). Даже если в страницу
 *                                    попадёт <script>, он не запустится:
 *                                    inline-скрипты запрещены. Это второй
 *                                    рубеж против XSS после экранирования.
 *   X-Frame-Options: DENY          — мера №18 + frame-ancestors 'none' в CSP.
 *                                    Страницу нельзя встроить в <iframe>,
 *                                    значит невозможен clickjacking.
 *   X-Content-Type-Options: nosniff — браузер не «угадывает» тип ответа,
 *                                    text/plain не исполнится как скрипт.
 *   Strict-Transport-Security      — требовать HTTPS (включаем в production).
 *   Referrer-Policy                — не утекает URL с токеном в Referer.
 *   X-Powered-By                   — удаляется: не сообщаем, что это Express
 *                                    (минус подсказка для подбора эксплойтов).
 *   Cross-Origin-Resource-Policy   — чужой сайт не может встроить наши ресурсы.
 */

const helmet = require('helmet');
const config = require('./../config/env');

const securityHeaders = helmet({
  // ── Мера №13: Content Security Policy ─────────────────────────────────────
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // Скрипты только свои, из отдельных .js-файлов. Inline запрещён —
      // поэтому public/app.js вынесен в файл, а не лежит в <script> в HTML.
      scriptSrc: ["'self'"],
      // Стили тоже отдельным файлом (public/styles.css)
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      // fetch/XHR только к своему origin
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],          // никаких <object>/<embed>/Flash
      baseUri: ["'self'"],            // нельзя подменить <base href>
      formAction: ["'self'"],         // форму нельзя отправить на чужой домен
      frameAncestors: ["'none'"],     // современный аналог X-Frame-Options: DENY
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },

  // ── Мера №18: X-Frame-Options: DENY ───────────────────────────────────────
  frameguard: { action: 'deny' },

  // HSTS включаем только в production: на http://localhost он мешает разработке
  hsts: config.isProduction
    ? { maxAge: 31536000, includeSubDomains: true, preload: false }
    : false,

  referrerPolicy: { policy: 'no-referrer' },
  noSniff: true,
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  // Заголовок X-Powered-By убирается helmet'ом (hidePoweredBy)
  xssFilter: true,
});

module.exports = securityHeaders;
