'use strict';

/**
 * Негативное и позитивное тестирование API: `npm run smoke`
 * (сервер должен быть уже запущен — npm run dev).
 *
 * Скрипт прогоняет те же сценарии, что лежат в Postman-коллекции,
 * и печатает таблицу «сценарий / ожидали / получили». Удобен, чтобы
 * проверить всё одной командой перед снятием скриншотов для отчёта.
 *
 * Проверяются, в том числе, негативные сценарии:
 *   - доступ к защищённому маршруту без токена и с подделанным токеном;
 *   - административное действие от имени роли user;
 *   - слабый пароль, неверный email, лишнее поле role (mass assignment);
 *   - SQL-инъекция в строке запроса;
 *   - неверный Content-Type, тело сверх лимита;
 *   - блокировка аккаунта после 5 неудачных входов;
 *   - невалидный и занятый slug, сортировка вне белого списка;
 *   - срабатывание rate limiting (429) — проверяется последним.
 *
 * ВАЖНО. Прогон делает больше обращений к /auth/*, чем позволяет штатный
 * лимит (10 запросов / 15 мин с одного IP), поэтому сервер для тестов
 * нужно запускать с поднятым лимитом:
 *
 *   AUTH_RATE_LIMIT_MAX=200 RATE_LIMIT_MAX=5000 USER_RATE_LIMIT_MAX=500 npm run dev
 *
 * Сам лимит при этом всё равно проверяется — последним пунктом списка,
 * когда остальные сценарии уже отработали.
 */

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
const rows = [];

function record(name, expected, actual, extra = '') {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  if (ok) passed += 1; else failed += 1;
  rows.push({
    status: ok ? 'OK  ' : 'FAIL',
    name,
    expected: Array.isArray(expected) ? expected.join('|') : expected,
    actual,
    extra,
  });
}

/** Минимальная обёртка над fetch: возвращает { status, body, headers }. */
async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    if (raw) {
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* text/plain — оставляем как есть */ }
  return { status: response.status, body: parsed, headers: response.headers };
}

function unique(prefix) {
  return `${prefix}.${Date.now().toString(36)}@example.com`;
}

async function main() {
  console.log(`\nТестирование ${BASE}\n${'─'.repeat(100)}`);

  // ── 0. Сервер жив ─────────────────────────────────────────────────────────
  const health = await call('GET', '/health');
  record('GET /health — сервер отвечает', 200, health.status);
  if (health.status !== 200) {
    console.error('Сервер не отвечает. Запустите: npm run dev');
    process.exit(1);
  }

  // ── 1. Заголовки безопасности (helmet, CSP, X-Frame-Options) ──────────────
  const headers = health.headers;
  record('Заголовок Content-Security-Policy присутствует (мера №13)',
    true, Boolean(headers.get('content-security-policy')));
  record('Заголовок X-Frame-Options: DENY (мера №18)',
    'DENY', headers.get('x-frame-options'));
  record('Заголовок X-Content-Type-Options: nosniff',
    'nosniff', headers.get('x-content-type-options'));
  record('Заголовок X-Powered-By скрыт',
    true, headers.get('x-powered-by') === null);

  // ── 2. Публичное чтение без токена ────────────────────────────────────────
  const publicList = await call('GET', '/api/diffs');
  record('GET /api/diffs без токена — публичный доступ', 200, publicList.status);

  // ── 3. Валидация регистрации ──────────────────────────────────────────────
  record('POST /auth/register с неверным email — 400',
    400, (await call('POST', '/auth/register', {
      body: { email: 'не-email', password: 'Str0ng#Pass1' },
    })).status);

  const weak = await call('POST', '/auth/register', {
    body: { email: unique('weak'), password: 'qwerty' },
  });
  record('POST /auth/register со слабым паролем — 400 (мера №3)', 400, weak.status,
    Array.isArray(weak.body.details) ? weak.body.details[0] : '');

  const massAssign = await call('POST', '/auth/register', {
    body: { email: unique('mass'), password: 'Str0ng#Pass1', role: 'admin' },
  });
  record('POST /auth/register с полем "role" — 400 (мера №9)', 400, massAssign.status,
    Array.isArray(massAssign.body.details) ? massAssign.body.details[0] : '');

  // ── 4. Успешная регистрация обычного пользователя ─────────────────────────
  const userEmail = unique('user');
  const userPassword = 'Str0ng#Pass1';
  const registered = await call('POST', '/auth/register', {
    body: { email: userEmail, password: userPassword },
  });
  record('POST /auth/register корректные данные — 201', 201, registered.status);
  record('Роль нового пользователя = user', 'user', registered.body?.user?.role);
  record('В ответе нет passwordHash',
    true, JSON.stringify(registered.body).includes('passwordHash') === false);

  const userToken = registered.body?.accessToken;

  // ── 5. Защищённый маршрут: с токеном и без ────────────────────────────────
  record('GET /auth/me без токена — 401', 401, (await call('GET', '/auth/me')).status);
  record('GET /auth/me с подделанным токеном — 401',
    401, (await call('GET', '/auth/me', { token: 'eyJhbGciOiJIUzI1NiJ9.e30.fake' })).status);
  const meResponse = await call('GET', '/auth/me', { token: userToken });
  record('GET /auth/me с токеном — 200', 200, meResponse.status, meResponse.body?.user?.email);

  // ── 6. Content-Type и размер тела ─────────────────────────────────────────
  record('POST с Content-Type: text/plain — 415 (мера №15)',
    415, (await call('POST', '/auth/login', {
      body: 'email=a@b.c', raw: true, headers: { 'Content-Type': 'text/plain' },
    })).status);

  const huge = 'x'.repeat(400 * 1024);
  record('POST тело 400 КБ — 413 (мера №12)',
    413, (await call('POST', '/api/diffs', {
      token: userToken,
      body: { title: 'big', fileA: { name: 'a', content: huge }, fileB: { name: 'b', content: '' } },
    })).status);

  // ── 7. SQL-инъекция в строке запроса (мера №29) ───────────────────────────
  const injection = await call('GET', "/api/diffs?author=' OR 1=1 --");
  record('GET /api/diffs с SQL-инъекцией в query — 400 (мера №29)', 400, injection.status);
  record('GET /api/diffs?limit=abc — 400 (валидация query)',
    400, (await call('GET', '/api/diffs?limit=abc')).status);
  record('GET /api/diffs?unknown=1 — 400 (неизвестный параметр)',
    400, (await call('GET', '/api/diffs?unknown=1')).status);

  // ── 8. CRUD сравнений от обычного пользователя ────────────────────────────
  record('POST /api/diffs без токена — 401',
    401, (await call('POST', '/api/diffs', {
      body: { title: 'x', fileA: { name: 'a', content: '1' }, fileB: { name: 'b', content: '2' } },
    })).status);

  const created = await call('POST', '/api/diffs', {
    token: userToken,
    body: {
      title: '<script>alert(1)</script>Отчёт по сборке',
      fileA: { name: 'build.old.log', content: 'step 1\nstep 2\nstep 3' },
      fileB: { name: 'build.new.log', content: 'step 1\nstep 2 (fixed)\nstep 3\nstep 4' },
    },
  });
  record('POST /api/diffs с токеном — 201', 201, created.status);
  record('HTML-теги вырезаны из title (мера №19)',
    'Отчёт по сборке', created.body?.title);
  record('author = email владельца, а не произвольная строка',
    userEmail, created.body?.author);

  const diffId = created.body?.id;

  record('PATCH своего сравнения — 200',
    200, (await call('PATCH', `/api/diffs/${diffId}`, {
      token: userToken, body: { title: 'Отчёт по сборке v2' },
    })).status);

  record('PATCH с лишним полем ownerId — 400 (мера №9)',
    400, (await call('PATCH', `/api/diffs/${diffId}`, {
      token: userToken, body: { title: 'x', ownerId: '00000000-0000-4000-8000-000000000000' },
    })).status);

  record('GET /api/diffs/:id/patch — 200 text/plain',
    200, (await call('GET', `/api/diffs/${diffId}/patch`)).status);

  // ── 8a. Уникальное поле slug и дополнительные эндпоинты (КР №1) ───────────
  const withSlug = await call('POST', '/api/diffs', {
    token: userToken,
    body: {
      title: 'Миграция схемы БД',
      slug: `migration-${Date.now().toString(36)}`,
      fileA: { name: 'v1.sql', content: 'SELECT 1;' },
      fileB: { name: 'v2.sql', content: 'SELECT 2;\nSELECT 3;' },
    },
  });
  record('POST /api/diffs со своим slug — 201', 201, withSlug.status, withSlug.body?.slug);

  record('GET /api/diffs/slug/:slug — 200 (поиск по уникальному полю)',
    200, (await call('GET', `/api/diffs/slug/${withSlug.body?.slug}`)).status);
  record('GET /api/diffs/slug/несуществующий — 404',
    404, (await call('GET', '/api/diffs/slug/net-takogo-sravneniya')).status);

  const dupSlug = await call('POST', '/api/diffs', {
    token: userToken,
    body: {
      title: 'Дубликат slug',
      slug: withSlug.body?.slug,
      fileA: { name: 'a', content: '1' },
      fileB: { name: 'b', content: '2' },
    },
  });
  record('POST с занятым slug — 201, но slug получает суффикс (уникальность)',
    true, dupSlug.status === 201 && dupSlug.body?.slug !== withSlug.body?.slug,
    `${withSlug.body?.slug} -> ${dupSlug.body?.slug}`);

  const badSlug = await call('POST', '/api/diffs', {
    token: userToken,
    body: {
      title: 'Плохой slug',
      slug: 'Плохой Slug!',
      fileA: { name: 'a', content: '1' },
      fileB: { name: 'b', content: '2' },
    },
  });
  record('POST с невалидным slug — 400 (валидация формата)', 400, badSlug.status);

  const titleSuffix = Date.now().toString(36);
  const autoSlug = await call('POST', '/api/diffs', {
    token: userToken,
    body: {
      title: `Автоматический slug из заголовка ${titleSuffix}`,
      fileA: { name: 'a', content: '1' },
      fileB: { name: 'b', content: '2' },
    },
  });
  record('POST без slug — сервер генерирует его из title',
    `avtomaticheskiy-slug-iz-zagolovka-${titleSuffix}`, autoSlug.body?.slug);

  const sorted = await call('GET', '/api/diffs?sort=-similarity&limit=5');
  record('GET /api/diffs?sort=-similarity — 200 (сортировка)', 200, sorted.status);
  record('Сортировка по убыванию схожести соблюдена', true,
    sorted.body?.items?.every((item, index, all) => index === 0
      || all[index - 1].stats.similarity >= item.stats.similarity));
  record('GET /api/diffs?sort=passwordHash — 400 (белый список сортировок)',
    400, (await call('GET', '/api/diffs?sort=passwordHash')).status);

  const stats = await call('GET', '/api/diffs/stats');
  record('GET /api/diffs/stats — 200 (подсчёт статистики)', 200, stats.status,
    `записей: ${stats.body?.totalDiffs}, авторов: ${stats.body?.uniqueAuthors}`);
  record('В статистике есть агрегаты и топ авторов', true,
    typeof stats.body?.linesAdded === 'number'
    && typeof stats.body?.netLineChange === 'number'
    && Array.isArray(stats.body?.topAuthors));
  record('GET /api/diffs/stats?author=... — 200 (фильтр статистики)',
    200, (await call('GET', `/api/diffs/stats?author=${encodeURIComponent(userEmail)}`)).status);
  record('GET /api/diffs/stats?unknown=1 — 400 (валидация query)',
    400, (await call('GET', '/api/diffs/stats?unknown=1')).status);

  record('GET /api/diffs/не-UUID — 400 (валидация params)',
    400, (await call('GET', '/api/diffs/123')).status);

  record('DELETE своего сравнения от роли user — 403 (только admin)',
    403, (await call('DELETE', `/api/diffs/${diffId}`, { token: userToken })).status);

  // ── 9. Ролевая модель: админ ──────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@diffservice.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin#2024pass';
  const adminLogin = await call('POST', '/auth/login', {
    body: { email: adminEmail, password: adminPassword },
  });
  record('POST /auth/login администратором — 200', 200, adminLogin.status);
  const adminToken = adminLogin.body?.accessToken;

  record('refresh-токен пришёл в httpOnly cookie (мера №5)',
    true, String(adminLogin.headers.get('set-cookie') || '').toLowerCase().includes('httponly'));

  record('GET /api/users от роли user — 403',
    403, (await call('GET', '/api/users', { token: userToken })).status);
  record('GET /api/users от администратора — 200',
    200, (await call('GET', '/api/users', { token: adminToken })).status);

  record('PATCH /api/users/:id/role от роли user — 403',
    403, (await call('PATCH', `/api/users/${registered.body?.user?.id}/role`, {
      token: userToken, body: { role: 'admin' },
    })).status);

  record('GET /api/admin/audit-log от роли user — 403',
    403, (await call('GET', '/api/admin/audit-log', { token: userToken })).status);

  record('DELETE /api/diffs/:id администратором — 204',
    204, (await call('DELETE', `/api/diffs/${diffId}`, { token: adminToken })).status);

  const audit = await call('GET', '/api/admin/audit-log?limit=5', { token: adminToken });
  record('GET /api/admin/audit-log администратором — 200 (мера №7)', 200, audit.status,
    `записей: ${audit.body?.total}`);

  // Смена роли выполняется ПОСЛЕ проверок прав пользователя: она отзывает
  // все его токены, и прежний Bearer перестаёт работать (401, а не 403)
  record('PATCH /api/users/:id/role от администратора — 200',
    200, (await call('PATCH', `/api/users/${registered.body?.user?.id}/role`, {
      token: adminToken, body: { role: 'moderator' },
    })).status);

  record('Старый токен пользователя после смены его роли — 401 (токен отозван)',
    401, (await call('GET', '/auth/me', { token: userToken })).status);

  // ── 10. Блокировка после 5 неудачных входов (мера №6) ─────────────────────
  const victimEmail = unique('victim');
  await call('POST', '/auth/register', { body: { email: victimEmail, password: 'Str0ng#Pass1' } });

  let lockStatus = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await call('POST', '/auth/login', {
      body: { email: victimEmail, password: 'Wrong#Pass1' },
    });
    lockStatus = response.status;
  }
  record('5-я неудачная попытка входа — 423 Locked (мера №6)', 423, lockStatus);

  const afterLock = await call('POST', '/auth/login', {
    body: { email: victimEmail, password: 'Str0ng#Pass1' },
  });
  record('Вход с ВЕРНЫМ паролем после блокировки — 423', 423, afterLock.status,
    typeof afterLock.body?.error === 'string' ? afterLock.body.error.slice(0, 60) : '');

  // ── 11. Сброс пароля по временному токену (мера №16) ──────────────────────
  const forgot = await call('POST', '/auth/forgot-password', { body: { email: victimEmail } });
  record('POST /auth/forgot-password — 202', 202, forgot.status);
  record('POST /auth/forgot-password для несуществующего email — тоже 202',
    202, (await call('POST', '/auth/forgot-password', {
      body: { email: 'nobody.' + Date.now() + '@example.com' },
    })).status);

  if (forgot.body?.devResetToken) {
    record('POST /auth/reset-password с верным токеном — 200 (мера №16)',
      200, (await call('POST', '/auth/reset-password', {
        body: { token: forgot.body.devResetToken, password: 'New#Str0ngPass2' },
      })).status);
    record('Повторное использование того же токена — 400',
      400, (await call('POST', '/auth/reset-password', {
        body: { token: forgot.body.devResetToken, password: 'Other#Str0ng3' },
      })).status);
    record('Вход новым паролем после сброса (блокировка снята) — 200',
      200, (await call('POST', '/auth/login', {
        body: { email: victimEmail, password: 'New#Str0ngPass2' },
      })).status);
  }

  // ── 12. 404 без раскрытия структуры ───────────────────────────────────────
  record('GET /api/несуществующий — 404', 404, (await call('GET', '/api/nope')).status);
  record('GET /.env — 404 (сканирование логируется)', 404, (await call('GET', '/.env')).status);

  // ── 13. Rate limiting (запускается последним: исчерпывает лимит) ──────────
  // Лимит берём из /api/admin/security, чтобы не угадывать настройку.
  const securityConfig = await call('GET', '/api/admin/security', { token: adminToken });
  const authLimit = securityConfig.body?.rateLimit?.authPerIp || 10;

  let limitedStatus = 0;
  let sentRequests = 0;
  for (let i = 0; i < authLimit + 5; i += 1) {
    sentRequests += 1;
    // forgot-password с несуществующим адресом: не нагружает bcrypt
    // eslint-disable-next-line no-await-in-loop
    const response = await call('POST', '/auth/forgot-password', {
      body: { email: `flood.${i}@example.com` },
    });
    if (response.status === 429) { limitedStatus = 429; break; }
  }
  record('Превышение лимита /auth/* — 429 (rate limiting)', 429, limitedStatus,
    `сработал на запросе №${sentRequests} при лимите ${authLimit}`);

  // ── Итоги ─────────────────────────────────────────────────────────────────
  console.log('');
  const width = Math.max(...rows.map((row) => row.name.length));
  rows.forEach((row) => {
    const extra = row.extra ? `  // ${row.extra}` : '';
    console.log(`[${row.status}] ${row.name.padEnd(width)}  ожидали ${String(row.expected).padStart(3)} / получили ${String(row.actual).padStart(3)}${extra}`);
  });

  console.log(`${'─'.repeat(100)}`);
  console.log(`Пройдено: ${passed}   Провалено: ${failed}   Всего: ${passed + failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Сбой тестового прогона:', error);
  process.exit(1);
});
