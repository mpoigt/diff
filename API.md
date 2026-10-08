# Diff Service API — описание

REST API сервиса сравнения файлов (diff-инструмент) с JWT-аутентификацией,
ролевой моделью и защитой от типовых уязвимостей OWASP Top 10.

- Базовый URL: `http://localhost:3000`
- Формат обмена: `application/json; charset=utf-8`
- Аутентификация: `Authorization: Bearer <accessToken>`
- Версия: 2.0.0

Эндпоинты аутентификации доступны по двум путям — `/auth/*` (как в задании)
и `/api/auth/*` (единый префикс для фронтенда). Далее указывается короткий вариант.

---

## 1. Роли и права доступа

| Роль | Уровень | Права |
|---|---|---|
| `user` | 1 | создаёт сравнения; редактирует и просматривает **свои** записи; читает публичные |
| `moderator` | 2 | всё, что `user`, плюс правка **любых** сравнений и просмотр списка пользователей |
| `admin` | 3 | всё, что `moderator`, плюс удаление сравнений и пользователей, смена ролей, снятие блокировок, audit log |

`roleGuard(role)` пропускает пользователя с уровнем **не ниже** требуемого,
поэтому `admin` автоматически проходит там, где достаточно `moderator`.

### Матрица доступа

| Метод | Путь | Анонимно | user | moderator | admin |
|---|---|:--:|:--:|:--:|:--:|
| GET | `/api/diffs` | ✅ | ✅ | ✅ | ✅ |
| GET | `/api/diffs/:id` | ✅ | ✅ | ✅ | ✅ |
| GET | `/api/diffs/:id/patch` | ✅ | ✅ | ✅ | ✅ |
| POST | `/api/diffs` | ❌ 401 | ✅ | ✅ | ✅ |
| PUT | `/api/diffs/:id` | ❌ 401 | только свои | ✅ | ✅ |
| PATCH | `/api/diffs/:id` | ❌ 401 | только свои | ✅ | ✅ |
| DELETE | `/api/diffs/:id` | ❌ 401 | ❌ 403 | ❌ 403 | ✅ |
| GET | `/api/users` | ❌ 401 | ❌ 403 | ✅ | ✅ |
| GET | `/api/users/:id` | ❌ 401 | только себя | ✅ | ✅ |
| PATCH | `/api/users/:id/role` | ❌ 401 | ❌ 403 | ❌ 403 | ✅ |
| POST | `/api/users/:id/unlock` | ❌ 401 | ❌ 403 | ❌ 403 | ✅ |
| DELETE | `/api/users/:id` | ❌ 401 | ❌ 403 | ❌ 403 | ✅ |
| GET | `/api/admin/audit-log` | ❌ 401 | ❌ 403 | ❌ 403 | ✅ |
| GET | `/api/admin/security` | ❌ 401 | ❌ 403 | ❌ 403 | ✅ |

---

## 2. Схема данных

### users

| Поле | Тип | Описание |
|---|---|---|
| `id` | UUID, PK | идентификатор (UUID, а не автоинкремент — нельзя перебрать) |
| `email` | VARCHAR(254), UNIQUE, NOT NULL | логин, нормализуется в нижний регистр |
| `passwordHash` | VARCHAR(72), NOT NULL | bcrypt-хеш, 12 раундов. Наружу не отдаётся никогда |
| `role` | ENUM('user','moderator','admin') | по умолчанию `user` |
| `failedAttempts` | INTEGER | счётчик неудачных входов (мера №6) |
| `lockUntil` | TIMESTAMP, NULL | до какого времени аккаунт заблокирован (мера №6) |
| `lastLoginAt` | TIMESTAMP, NULL | время последнего успешного входа |
| `resetTokenHash` | VARCHAR(64), NULL | SHA-256 от токена сброса пароля (мера №16) |
| `resetTokenExpires` | TIMESTAMP, NULL | срок действия токена сброса — 1 час |
| `tokenVersion` | INTEGER | инкремент обесценивает все выданные access-токены |
| `createdAt`, `updatedAt` | TIMESTAMP | служебные метки Sequelize |

### diffs — основная сущность

| Поле | Тип | Описание |
|---|---|---|
| `id` | UUID, PK | |
| `title` | VARCHAR(120), NOT NULL | название сравнения |
| `author` | VARCHAR(120), NOT NULL | email автора, **подставляется сервером** |
| `fileAName`, `fileBName` | VARCHAR(255), NOT NULL | имена сравниваемых файлов |
| `fileAContent`, `fileBContent` | TEXT, NOT NULL | содержимое, до 100 КБ на файл |
| `stats` | JSONB, NOT NULL | `{added, removed, unchanged, linesOld, linesNew, identical, similarity}` |
| `changes` | JSONB, NOT NULL | массив `{type, oldLine, newLine, content}` |
| `ownerId` | UUID, FK → users.id, NULL | владелец; при удалении пользователя становится NULL |
| `createdAt`, `updatedAt` | TIMESTAMP | |

### sessions — активные refresh-токены (меры №5, №20)

| Поле | Тип | Описание |
|---|---|---|
| `id` | UUID, PK | |
| `userId` | UUID, FK → users.id | ON DELETE CASCADE |
| `tokenHash` | VARCHAR(64), UNIQUE | SHA-256 от refresh-токена; сам токен в БД не хранится |
| `expiresAt` | TIMESTAMP | срок действия (7 дней) |
| `revokedAt` | TIMESTAMP, NULL | время отзыва |
| `ip`, `userAgent` | VARCHAR | откуда создана сессия |

### audit_logs — журнал действий администратора (мера №7)

| Поле | Тип | Описание |
|---|---|---|
| `id` | UUID, PK | |
| `actorId`, `actorEmail`, `actorRole` | — | кто выполнил действие |
| `action` | VARCHAR(128) | код действия, например `USER_ROLE_CHANGED` |
| `method`, `path` | VARCHAR | HTTP-метод и путь |
| `targetType`, `targetId` | VARCHAR | над чем выполнено |
| `statusCode` | INTEGER | результат (в журнал попадают и отказы 403/404) |
| `ip`, `userAgent` | VARCHAR | откуда |
| `metadata` | JSONB, NULL | дополнительные поля |
| `createdAt` | TIMESTAMP | |

---

## 3. Аутентификация

### POST /auth/register — регистрация

Роль нового пользователя всегда `user`. Передача поля `role` в теле запроса
приводит к ошибке 400 (защита от mass assignment).

**Тело**

```json
{
  "email": "student@example.com",
  "password": "Str0ng#Pass1",
  "passwordConfirm": "Str0ng#Pass1"
}
```

`passwordConfirm` необязателен; если передан — должен совпадать с `password`.

**Требования к паролю:** минимум 8 символов, строчная и заглавная латинские
буквы, цифра, специальный символ, без пробелов; пароль не должен входить
в список распространённых.

**201 Created**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenType": "Bearer",
  "expiresIn": "15m",
  "user": {
    "id": "7b1f...e2",
    "email": "student@example.com",
    "role": "user",
    "isLocked": false,
    "lastLoginAt": null,
    "createdAt": "2026-10-08T18:00:00.000Z",
    "updatedAt": "2026-10-08T18:00:00.000Z"
  }
}
```

Вместе с ответом устанавливается cookie
`refreshToken=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`.

**Ошибки:** 400 (валидация), 409 (email занят), 415 (неверный Content-Type), 429 (rate limit).

---

### POST /auth/login — выдача JWT

**Тело**

```json
{ "email": "student@example.com", "password": "Str0ng#Pass1" }
```

**200 OK** — тот же формат, что у регистрации.

**Ошибки**

| Код | Когда | Тело |
|---|---|---|
| 400 | нет обязательного поля | `{"error":"Некорректные данные запроса","details":[...]}` |
| 401 | нет такого email **или** неверный пароль | `{"error":"Неверный email или пароль"}` |
| 423 | аккаунт заблокирован после 5 неудач | `{"error":"Превышено число попыток входа (5). Аккаунт заблокирован на 15 мин."}` |
| 429 | более 10 запросов за 15 минут с одного IP | `{"error":"Слишком много запросов...","retryAfterSeconds":900}` |

Текст ошибки 401 **одинаков** для «нет пользователя» и «неверный пароль» —
иначе по ответу можно было бы перечислить зарегистрированные адреса.

---

### GET /auth/me — текущий пользователь

Требует заголовок `Authorization: Bearer <accessToken>`.

**200 OK**

```json
{
  "user": { "id": "7b1f...", "email": "student@example.com", "role": "user", "isLocked": false },
  "activeSessions": 1,
  "maxSessions": 3
}
```

**401** — токен отсутствует, истёк, подделан или отозван.

---

### POST /auth/refresh — обновление access-токена

Тела нет. Refresh-токен берётся из httpOnly cookie, установленной при входе.
Каждый вызов **отзывает** старую сессию и выдаёт новую пару токенов (ротация).

**200 OK** — новый `accessToken` + новая cookie.
**401** — cookie нет, токен недействителен, или сессия уже использована
(в последнем случае отзываются **все** сессии пользователя — это признак кражи токена).

---

### Остальные эндпоинты аутентификации

| Метод | Путь | Описание | Коды |
|---|---|---|---|
| POST | `/auth/logout` | отозвать текущую сессию, очистить cookie | 200 |
| POST | `/auth/logout-all` | закрыть все сессии (нужен Bearer) | 200, 401 |
| GET | `/auth/sessions` | список своих сессий (нужен Bearer) | 200, 401 |
| POST | `/auth/forgot-password` | создать токен сброса на 1 час | 202 всегда |
| POST | `/auth/reset-password` | установить новый пароль по токену | 200, 400 |
| POST | `/auth/change-password` | сменить пароль (нужен Bearer) | 200, 400, 401 |

`POST /auth/forgot-password` отвечает **202 с одинаковым текстом**
независимо от того, зарегистрирован адрес или нет. При `NODE_ENV=development`
в ответ дополнительно попадает поле `devResetToken` — чтобы сценарий можно было
проверить без почтового сервера.

---

## 4. Сравнения файлов (основная сущность)

### GET /api/diffs — список, публично

**Параметры строки запроса** (любой другой параметр → 400)

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `search` | строка ≤120 | — | подстрока в названии или именах файлов |
| `author` | строка ≤120 | — | точное совпадение автора (без учёта регистра) |
| `onlyChanged` | boolean (`true`/`1`) | — | только непустые diff |
| `include` | `changes` | — | вернуть полные `changes` вместо краткого вида |
| `limit` | целое 1…100 | 20 | размер страницы |
| `offset` | целое ≥0 | 0 | смещение |

**200 OK**

```json
{
  "total": 12,
  "count": 2,
  "limit": 20,
  "offset": 0,
  "items": [
    {
      "id": "3c9a...",
      "title": "README: правки перед релизом",
      "author": "student@example.com",
      "ownerId": "7b1f...",
      "fileA": { "name": "README.old.md" },
      "fileB": { "name": "README.new.md" },
      "stats": { "added": 2, "removed": 1, "unchanged": 3, "similarity": 75, "identical": false },
      "createdAt": "2026-10-08T18:00:00.000Z",
      "updatedAt": "2026-10-08T18:00:00.000Z"
    }
  ]
}
```

### GET /api/diffs/:id — одно сравнение, публично

`:id` обязан быть UUID v4, иначе 400. **200 OK** — объект с полями
`fileA.content`, `fileB.content` и массивом `changes`. **404** — записи нет.

### GET /api/diffs/:id/patch — unified-представление

Отдаёт `text/plain; charset=utf-8`:

```
--- README.old.md
+++ README.new.md
 # Diff Service
-Версия 0.9
+Версия 1.0
```

### POST /api/diffs — создание, нужен токен

```json
{
  "title": "index.js до и после",
  "fileA": { "name": "index.old.js", "content": "строка 1\nстрока 2" },
  "fileB": { "name": "index.new.js", "content": "строка 1\nстрока 2 изменена\nстрока 3" }
}
```

Разрешены **только** эти три поля. `author` и `ownerId` сервер берёт из токена;
`id`, `stats`, `changes`, `createdAt` вычисляет сам. HTML-теги вырезаются
из `title` и имён файлов, но **не** из `content` — это данные сравниваемых файлов.

**201 Created** + заголовок `Location: /api/diffs/<id>`.
**Ошибки:** 400, 401, 413 (тело > 100 КБ), 415, 429.

### PUT /api/diffs/:id — полная замена

Те же поля, что при создании. Доступно владельцу либо `moderator`/`admin`.
`author`/`ownerId` при редактировании не меняются.
**200 OK**; **403** — чужая запись и роль ниже `moderator`; **404** — нет записи.

### PATCH /api/diffs/:id — частичное обновление

Любое подмножество `title`, `fileA`, `fileB`, но **минимум одно поле** (иначе 400).
Пересчёт diff выполняется только если менялось содержимое файлов.

### DELETE /api/diffs/:id — только администратор

**204 No Content**; **403** для `user` и `moderator`; **404** — нет записи.
Каждое удаление попадает в audit log как `DIFF_DELETED`.

---

## 5. Пользователи и администрирование

| Метод | Путь | Роль | Описание |
|---|---|---|---|
| GET | `/api/users?role=&search=&limit=&offset=` | moderator+ | список пользователей без хешей паролей |
| GET | `/api/users/:id` | сам / moderator+ | профиль + число созданных сравнений |
| PATCH | `/api/users/:id/role` | admin | `{"role":"moderator"}` — другие поля запрещены |
| POST | `/api/users/:id/unlock` | admin | снять блокировку после перебора пароля |
| DELETE | `/api/users/:id` | admin | удалить пользователя (204) |
| GET | `/api/admin/audit-log?action=&actorId=&limit=&offset=` | admin | журнал действий администраторов |
| GET | `/api/admin/security` | admin | сводка активных настроек безопасности |

Ограничения, встроенные в логику:

- администратор не может понизить **собственную** роль;
- администратор не может удалить **себя**;
- нельзя удалить **последнего** администратора;
- смена роли и удаление отзывают все сессии затронутого пользователя,
  поэтому новые права вступают в силу немедленно, а не через 15 минут.

---

## 6. Формат ошибок

Все ошибки возвращаются единым JSON-объектом:

```json
{
  "error": "Некорректные данные запроса",
  "details": [
    "Поле \"email\" обязательно",
    "Пароль не соответствует политике (Пароль должен содержать цифру)"
  ]
}
```

| Код | Значение |
|---|---|
| 400 | ошибка валидации (Joi или встроенные валидаторы Sequelize) |
| 401 | нет токена / токен недействителен / неверный логин или пароль |
| 403 | роли недостаточно либо попытка изменить чужой ресурс |
| 404 | ресурс или маршрут не найден |
| 409 | конфликт (email уже зарегистрирован) |
| 413 | тело запроса превышает лимит (`BODY_LIMIT`, по умолчанию 100 КБ) |
| 415 | `Content-Type` не `application/json` |
| 423 | аккаунт заблокирован после неудачных попыток входа |
| 429 | превышен лимит частоты запросов |
| 500 | внутренняя ошибка |

### Ответ 500 в разных окружениях

`NODE_ENV=production` — наружу ничего лишнего:

```json
{ "error": "Внутренняя ошибка сервера", "requestId": "0f3c8d9a-..." }
```

`NODE_ENV=development` — добавляются отладочные поля:

```json
{
  "error": "Внутренняя ошибка сервера",
  "requestId": "0f3c8d9a-...",
  "devMessage": "relation \"diffs\" does not exist",
  "devStack": ["Error: relation ...", "    at Query.run ..."]
}
```

Полный стек в любом окружении пишется в `logs/error-YYYY-MM-DD.log`
вместе с `requestId` — по нему администратор находит запись в журнале.

---

## 7. Заголовки безопасности

Каждый ответ содержит (устанавливает `helmet`):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self';
  form-action 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-site
Cross-Origin-Opener-Policy: same-origin
```

Заголовок `X-Powered-By` удалён. В `production` дополнительно выставляется
`Strict-Transport-Security: max-age=31536000; includeSubDomains`.

Ответы на `/api/*` содержат заголовки лимитов:
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

---

## 8. Ограничения частоты запросов

| Лимитер | Ключ | Лимит | Применяется к |
|---|---|---|---|
| глобальный | IP | 300 / 15 мин | всё приложение |
| авторизационный | IP | 10 / 15 мин | `/auth/login`, `/register`, `/refresh`, `/forgot-password`, `/reset-password` |
| пользовательский | user ID | 60 / 15 мин | защищённые маршруты |
| на запись | user ID | 30 / 15 мин | POST / PUT / PATCH / DELETE |

Все значения настраиваются через `.env`.
