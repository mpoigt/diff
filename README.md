# Diff Service API — REST API с аутентификацией и защитой от уязвимостей

Серверная часть курсового проекта **«Сервис для сравнения файлов (diff-инструмент)
с визуализацией изменений»**.

REST API ресурса `diffs` (история сравнений файлов) + система аутентификации на JWT,
ролевая модель из трёх ролей, валидация всех входных данных и набор мер защиты
от типовых уязвимостей OWASP Top 10.

- Стек: **Node.js + Express.js**
- БД: **PostgreSQL** через ORM **Sequelize** (параметризованные запросы)
- Аутентификация: **JWT** (access + refresh), пароли — **bcrypt**
- Валидация: **Joi** + встроенные валидаторы Sequelize
- Безопасность: **helmet**, **express-rate-limit**, **sanitize-html**, httpOnly cookie
- Логирование: **winston** + ротация файлов

Документация API — [API.md](API.md). Отчёт с обоснованием выбранных мер — [REPORT.md](REPORT.md).

- [КР № 1 — запуск и проверка серверной части](docs/KR21-guide.md)
- [КР № 2 — локальный запуск React и настройки облачного хостинга](docs/KR22-guide.md)

---

## Быстрый старт

```bash
# 1. Зависимости
npm install

# 2. Конфигурация: скопировать пример и заполнить
cp .env.example .env          # Windows: copy .env.example .env

# 3. Сгенерировать секреты JWT и вписать их в .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # -> JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # -> JWT_REFRESH_SECRET

# 4. Создать базу данных (PostgreSQL должен быть запущен)
npm run db:create

# 5. Запуск
npm run dev     # разработка, автоперезапуск (nodemon)
npm start       # обычный запуск
```

Сервер: <http://localhost:3000> · демо-страница с визуализацией diff: <http://localhost:3000/>
· описание API: <http://localhost:3000/api>

При первом запуске автоматически создаются:

- администратор с учётными данными из `ADMIN_EMAIL` / `ADMIN_PASSWORD`;
- две демонстрационные записи сравнений, чтобы `GET /api/diffs` не был пустым.

### Заполнение .env

Минимум, который нужно поменять в скопированном `.env`:

| Переменная | Что вписать |
|---|---|
| `DATABASE_URL` | `postgres://postgres:ВАШ_ПАРОЛЬ@localhost:5432/diff_service` |
| `JWT_SECRET` | случайная строка ≥32 символов (команда выше) |
| `JWT_REFRESH_SECRET` | **другая** случайная строка ≥32 символов |
| `ADMIN_PASSWORD` | пароль администратора по политике сложности |

> **Важно про `#` в `.env`.** `dotenv` считает всё после символа `#` комментарием,
> поэтому значения со спецсимволами берите в кавычки:
> `ADMIN_PASSWORD="Admin#2024pass"`. Без кавычек пароль молча обрежется до `Admin`.

Файл `.env` в `.gitignore` и в репозиторий не попадает — в Git лежит только `.env.example`.

Если сервер работает за обратным прокси, укажите его IP-адрес или CIDR в
`TRUSTED_PROXIES`. При прямом подключении оставьте значение пустым. Это
сохраняет привязку ограничений частоты и журналов к адресу клиента.

### Облачная БД вместо локальной

Для Neon / Render / Supabase достаточно подставить их строку подключения
и включить TLS:

```dotenv
DATABASE_URL=postgres://user:pass@ep-xxx.eu-central-1.aws.neon.tech/diff_service
DB_SSL=true
```

---

## Структура проекта

```
server.js                           точка входа: подключение к БД, затем app.listen
.env.example                        шаблон конфигурации (секретов не содержит)
API.md                              документация API
REPORT.md                           отчёт по лабораторной работе
docs/
  DiffServiceAPI.postman_collection.json   коллекция Postman (71 запрос с тестами)
requests.http                       те же запросы для REST Client (VS Code)
scripts/
  createDatabase.js                 npm run db:create — создание БД
  smokeTest.js                      npm run smoke — 62 автопроверки API
src/
  app.js                            сборка Express: порядок middleware
  config/
    env.js                          чтение и проверка переменных окружения
    db.js                           подключение Sequelize к PostgreSQL
  models/
    index.js                        регистрация моделей, связи, сидер
    user.model.js                   User: email, passwordHash, role, lockUntil, ...
    diff.model.js                   Diff — основная сущность проекта
    session.model.js                активные refresh-токены (меры №5, №20)
    auditLog.model.js               журнал действий администратора (мера №7)
  validation/
    common.js                       общие блоки Joi: uuid, email, password
    auth.schemas.js                 схемы /auth/*
    diff.schemas.js                 схемы /api/diffs/* + схема query-параметров
    user.schemas.js                 схемы администрирования
  middleware/
    ApiError.js                     ошибка с HTTP-статусом
    validate.js                     валидатор Joi для body/params/query
    authenticate.js                 проверка JWT, роль берётся из БД
    roleGuard.js                    roleGuard(role) + ownerOrRole()
    rateLimiters.js                 4 лимитера: global / auth / per-user / write
    contentType.js                  требование application/json (мера №15)
    sanitize.js                     удаление HTML-тегов + детектор инъекций
    securityHeaders.js              helmet, CSP, X-Frame-Options
    corsWhitelist.js                CORS по белому списку (мера №22)
    audit.js                        запись действий администратора
    logger.js                       HTTP-лог
    notFound.js                     404 + отметка сканеров
    errorHandler.js                 generic errors в production (мера №24)
  controllers/
    auth.controller.js              register / login / me / refresh / reset
    users.controller.js             администрирование пользователей
    diffs.controller.js             CRUD сравнений
  routes/
    auth.routes.js                  /auth/* и /api/auth/*
    diffs.routes.js                 /api/diffs/*
    users.routes.js                 /api/users/*
    admin.routes.js                 /api/admin/*
  services/
    token.service.js                выдача/проверка токенов, сессии
  utils/
    diffEngine.js                   построчный diff на основе LCS
    logger.js                       winston: app / security / error / audit
    password.js                     политика сложности, bcrypt, токены
public/                             демо-страница (XSS-безопасный рендер)
logs/                               логи с ротацией (в .gitignore)
```

---

## Роли и права

| Роль | Права |
|---|---|
| `user` | создаёт сравнения; правит и удаляет **свои**; читает публичное |
| `moderator` | + правка **любых** сравнений, просмотр списка пользователей |
| `admin` | + удаление сравнений и пользователей, смена ролей, снятие блокировок, audit log |

| Метод | Путь | Кто может |
|---|---|---|
| GET | `/api/diffs`, `/api/diffs/:id`, `/api/diffs/:id/patch` | кто угодно, без токена |
| POST | `/api/diffs` | любой аутентифицированный |
| PUT / PATCH | `/api/diffs/:id` | владелец либо `moderator`/`admin` |
| DELETE | `/api/diffs/:id` | только `admin` |
| GET | `/api/users` | `moderator`/`admin` |
| PATCH | `/api/users/:id/role` | только `admin` |
| DELETE | `/api/users/:id` | только `admin` |
| GET | `/api/admin/audit-log` | только `admin` |

Полная матрица доступа и форматы запросов — в [API.md](API.md).

---

## Реализованные меры безопасности

### Обязательные

| Мера | Как реализовано |
|---|---|
| Хеширование паролей | bcrypt, 12 раундов, уникальная соль; проверка через `bcrypt.compare` |
| JWT | HS256, access 15 мин + refresh 7 дней, алгоритм зафиксирован |
| Ролевая модель | 3 роли, `roleGuard(role)` с иерархией уровней |
| Валидация входных данных | Joi на всех эндпоинтах: тело, `:id`, строка запроса |
| Защита от SQL-инъекций | только ORM Sequelize, запросы параметризованные (`$1, $2, ...`) |
| Защита от XSS | helmet + CSP, `sanitize-html` на входе, `textContent` на выводе |
| Rate limiting | `express-rate-limit`: 300 запросов / 15 мин с IP на всё API |
| Логирование подозрительных действий | winston: отдельный файл `logs/security-*.log` |

### Дополнительные (выбрано 13 из таблицы задания)

| № | Мера | Где смотреть |
|---|---|---|
| 3 | Проверка сложности пароля | `src/utils/password.js` |
| 5 | JWT с refresh-токеном в httpOnly cookie | `src/services/token.service.js` |
| 6 | Блокировка после 5 неудачных входов на 15 минут | `src/controllers/auth.controller.js` |
| 7 | Audit log действий администратора | `src/middleware/audit.js` |
| 9 | Защита от массового присвоения | `src/middleware/validate.js` |
| 12 | Ограничение размера тела запроса | `src/app.js` |
| 13 | Content Security Policy | `src/middleware/securityHeaders.js` |
| 15 | Валидация Content-Type | `src/middleware/contentType.js` |
| 16 | Токен сброса пароля на 1 час | `src/controllers/auth.controller.js` |
| 18 | X-Frame-Options: DENY | `src/middleware/securityHeaders.js` |
| 19 | Санитизация входных данных | `src/middleware/sanitize.js` |
| 20 | Ограничение одновременных сессий | `src/services/token.service.js` |
| 22 | CORS с белым списком доменов | `src/middleware/corsWhitelist.js` |
| 24 | Generic errors в production | `src/middleware/errorHandler.js` |
| 25 | Rate limiting на пользователя | `src/middleware/rateLimiters.js` |
| 29 | Проверка query-параметров на инъекции | `src/middleware/sanitize.js` |
| 30 | Логирование ошибок в отдельный файл с ротацией | `src/utils/logger.js` |

Обоснование выбора каждой меры применительно к проекту — в [REPORT.md](REPORT.md).

---

## Тестирование

### Автоматический прогон

```bash
# терминал 1 — сервер с поднятыми лимитами (прогон делает больше 10 запросов к /auth/*)
AUTH_RATE_LIMIT_MAX=200 RATE_LIMIT_MAX=5000 USER_RATE_LIMIT_MAX=500 npm run dev

# терминал 2 — 62 проверки, включая негативные сценарии
npm run smoke
```

На Windows (PowerShell) переменные задаются так:

```powershell
$env:AUTH_RATE_LIMIT_MAX=200; $env:RATE_LIMIT_MAX=5000; $env:USER_RATE_LIMIT_MAX=500; npm run dev
```

Скрипт печатает таблицу «сценарий / ожидали / получили» и завершается с кодом 1,
если хоть одна проверка провалилась.

### Postman

1. Импортировать `docs/DiffServiceAPI.postman_collection.json`.
2. Проверить переменную коллекции `baseUrl` (по умолчанию `http://localhost:3000`).
3. Выполнять папки по порядку: запросы входа сами сохраняют токены в переменные.
4. Для запуска всей коллекции используйте отдельный экземпляр сервера с поднятым лимитом аутентификации, как для smoke-тестов выше. Проверку срабатывания штатного лимита выполняйте отдельно в папке **09. Ограничение частоты запросов**.

В коллекции 71 запрос; у каждого есть тесты (`pm.test`), в том числе негативные
сценарии с префиксом «НЕГАТИВ».

### REST Client

Файл `requests.http` — те же сценарии для расширения REST Client в VS Code.

---

## Логи

Пишутся в `logs/` (каталог в `.gitignore`), ротация ежедневная, архивы жмутся
в `.gz`, хранятся 14 дней, размер файла ограничен 5 МБ.

| Файл | Содержимое |
|---|---|
| `app-YYYY-MM-DD.log` | обычная работа: запросы, запуск, входы |
| `security-YYYY-MM-DD.log` | подозрительные действия (см. таблицу ниже) |
| `error-YYYY-MM-DD.log` | только ошибки, со стеком и `requestId` (мера №30) |
| `audit-YYYY-MM-DD.log` | действия администраторов (мера №7) |

События в security-логе: `LOGIN_FAILED_WRONG_PASSWORD`, `LOGIN_FAILED_NO_USER`,
`ACCOUNT_LOCKED_BRUTE_FORCE`, `LOGIN_BLOCKED_LOCKED_ACCOUNT`, `AUTH_TOKEN_INVALID`,
`AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_REVOKED`, `FORBIDDEN_ROLE`, `FOREIGN_RESOURCE_ACCESS`,
`FOREIGN_PROFILE_ACCESS`, `MASS_ASSIGNMENT_ATTEMPT`, `SQL_INJECTION_ATTEMPT`,
`HTML_STRIPPED_FROM_INPUT`, `INVALID_CONTENT_TYPE`, `RATE_LIMIT_GLOBAL`,
`RATE_LIMIT_AUTH`, `RATE_LIMIT_PER_USER`, `RATE_LIMIT_WRITE`, `SESSION_LIMIT_EXCEEDED`,
`REFRESH_TOKEN_REUSE`, `SCANNER_PROBE`.

Пример записи:

```json
{
  "event": "ACCOUNT_LOCKED_BRUTE_FORCE",
  "ip": "::ffff:127.0.0.1",
  "method": "POST",
  "url": "/auth/login",
  "userAgent": "PostmanRuntime/7.37.0",
  "userId": "2aa76280-b492-4696-87f0-6e81d1358bf2",
  "email": "victim@example.com",
  "attempts": 5,
  "lockMinutes": 15,
  "level": "warn",
  "timestamp": "2026-10-08 20:56:28"
}
```

Ни пароли, ни токены, ни заголовок `Authorization`, ни cookie в логи не попадают.

---

## Полезные команды

| Команда | Что делает |
|---|---|
| `npm run dev` | запуск с автоперезапуском |
| `npm start` | обычный запуск |
| `npm run db:create` | создать базу данных, если её нет |
| `npm run smoke` | прогнать 62 автопроверки API |
| `npm run security:check` | `npm audit` по production-зависимостям |

---

## Переход с предыдущей версии

В прошлой версии данные хранились в массиве в памяти процесса, аутентификации не было.
Что изменилось:

- массив заменён на таблицы PostgreSQL (`users`, `diffs`, `sessions`, `audit_logs`);
- добавлены аутентификация, роли и все перечисленные меры безопасности;
- `id` стали UUID вместо последовательных чисел (нельзя перебрать записи);
- поле `author` больше не принимается от клиента — подставляется из токена;
- `POST`/`PUT`/`PATCH`/`DELETE` требуют токен и соответствующую роль;
- `GET`-эндпоинты остались публичными, формат их ответов сохранён,
  поэтому старый фронтенд и прежние запросы продолжают работать.
