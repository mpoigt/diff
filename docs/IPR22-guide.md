# ИПР 2.2. CI/CD и мониторинг

Облачные кабинеты подключаются отдельно. Ветка содержит рабочие локальные проверки, конфигурации и инструкцию для активации.

## 1. Репозиторий и проверки

1. Ветка `ipr22` включает backend из `kr21` и React-клиент из `kr22`.
2. В [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) задача `verify` устанавливает зависимости из двух файлов блокировки, проверяет синтаксис, поднимает PostgreSQL 17, запускает сервер, 62 проверки API и проверку метрик, затем собирает React на Node.js 22.
3. GitHub запускает проверки на push и pull request для `main`, `ipr22` и `kr22`. Развёртывание запускается после успешных проверок, если `ENABLE_DEPLOY=true` и push пришёл в `DEPLOY_BRANCH`. Ветка по умолчанию для развёртывания — `main`.
4. Локально выполните шаги из [KR21-guide.md](KR21-guide.md) и [KR22-guide.md](KR22-guide.md). Дополнительно запустите `node scripts/checkMetrics.js http://localhost:33021`.

## 2. Render и Netlify

1. Создайте PostgreSQL, например в Neon. Подключите репозиторий к Render через Blueprint из `ipr22`. Задайте `DATABASE_URL`, `CORS_WHITELIST` и, если нужен администратор, `ADMIN_EMAIL`/учётные данные через Settings → Environment. Значения JWT генерируются отдельно для токенов доступа и обновления. Endpoint `/ready` проверяет PostgreSQL.
2. Подключите репозиторий в Netlify. Для связанного пайплайна выберите `ipr22` как production branch. Укажите `VITE_API_URL` с HTTPS-адресом Render и `GATED_NETLIFY_BUILDS=true`. Конфигурация `netlify.toml` направляет вложенные маршруты в `index.html` и пропускает запуск сборки от обычного Git-события при включённом gate. Build hooks должны оставаться доступны.
3. Укажите HTTPS-адрес Netlify в `CORS_WHITELIST` Render. Добавьте в GitHub Actions Variables `BACKEND_URL`, `FRONTEND_URL`, `DEPLOY_BRANCH=ipr22`. В Actions Secrets задайте `RENDER_DEPLOY_HOOK` и `NETLIFY_BUILD_HOOK`. После проверки значений установите `ENABLE_DEPLOY=true`.
4. `scripts/deploy.mjs` передаёт SHA в Render Deploy Hook, проверяет совпадение ревизии через `/ready`, запускает Netlify Build Hook и проверяет `/version.json`. Netlify передаёт хеш сборки через `COMMIT_REF`. При несовпадении ревизии работа завершается ошибкой.
5. После первого облачного запуска проверьте главную страницу, прямую ссылку на детали и запросы браузера к HTTPS-адресу API. Зафиксируйте адреса рабочих экземпляров в README. Бесплатный веб-сервис Render может переходить в спящий режим; база Render Free Postgres имеет отдельное ограничение срока жизни. [Render Free](https://render.com/docs/free) · [Render Deploy Hooks](https://render.com/docs/deploy-hooks) · [Netlify Build Hooks](https://docs.netlify.com/build/configure-builds/build-hooks/)

## 3. Uptime и Telegram

1. Создайте в UptimeRobot два HTTP-монитора: HTTPS-адрес backend с путём `/ready` и главную страницу frontend. Интервал выбирается по возможностям вашего тарифа. Проверьте статусы обоих мониторов.
2. Подключите контакт Telegram через интеграцию UptimeRobot и выберите его для обоих мониторов. Проверьте тестовое уведомление на отдельном тестовом мониторе.
3. Для уведомления GitHub Actions создайте бота через BotFather, добавьте его в нужный чат и получите идентификатор чата. Сохраните `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` в GitHub Actions Secrets, включите `ENABLE_TELEGRAM=true`. Задача `notify` передаёт статус проверки и деплоя со ссылкой на запуск. [Интеграция UptimeRobot](https://uptimerobot.com/integrations/telegram-integration/) · [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage)

## 4. Логи, ошибки и метрики

1. Создайте источник логов Better Stack. В Render Environment задайте `BETTER_STACK_LOGS_URL` и `BETTER_STACK_SOURCE_TOKEN`. Отправляются структурированные события запуска и ответы 4xx/5xx. Метод, код и ревизия передаются без тела, токена пользователя, адреса электронной почты или строки запроса. [Better Stack HTTP ingest](https://betterstack.com/docs/logs/ingesting-data/http/logs/)
2. Создайте отдельные проекты Sentry для Node.js и React. Сохраните `SENTRY_DSN` в Render и `VITE_SENTRY_DSN` в Netlify. Пересоберите клиент. SDK отправляют очищенные сведения об исключениях, включая позиции кадров. Пароли, заголовки, тела запросов и подробности SQL в Sentry не передаются. [Sentry Node.js](https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/)
3. С настроенными переменными Sentry и Better Stack выполните `node scripts/checkTelemetry.js` в отдельной тестовой среде. Проверьте появление события в Sentry Issues и `telemetry.check` в Better Stack Live tail. Локальная доставка на тестовый приёмник не подтверждает облачный дашборд.
4. Откройте `/metrics.html` на сервере. Страница читает JSON с `/metrics` и показывает время работы, количество ответов, число 5xx, память и накопленное процессорное время. Счётчики относятся к одному процессу и сбрасываются при перезапуске.
5. После активации сохраните реальные ссылки на приложение, мониторы, дашборды и контакт Telegram в README. Для отчёта дополните локальные снимки снимками облачного запуска, Live tail, Sentry Issues и тестовых уведомлений.
