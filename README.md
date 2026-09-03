# Diff Service API — лабораторная работа 21 (Node.js + Express.js)

Серверная часть курсового проекта **«Сервис для сравнения файлов (diff-инструмент) с
визуализацией изменений»**. REST API для ресурса `diffs` — история сравнений файлов.

Данные хранятся в массиве в памяти процесса (по условию работы), слой модели изолирован,
чтобы в следующей лабораторной заменить его на базу данных без правки контроллеров.

## Запуск

```bash
npm install          # установка зависимостей
npm run dev          # режим разработки (nodemon, автоперезапуск)
npm start            # обычный запуск
```

Сервер: <http://localhost:3000>
Демо-страница с визуализацией diff: <http://localhost:3000/>
Порт меняется переменной окружения `PORT`.

## Структура проекта

```
server.js                        точка входа: запуск HTTP-сервера
src/
  app.js                         сборка Express-приложения, подключение middleware
  routes/diffs.routes.js         маршруты ресурса /api/diffs
  controllers/diffs.controller.js обработчики запросов, коды ответов
  models/diff.model.js           хранилище (массив) и операции над ним
  middleware/
    ApiError.js                  класс ошибки с HTTP-статусом
    errorHandler.js              глобальный обработчик ошибок (4 аргумента)
    notFound.js                  404 для несуществующих маршрутов
    logger.js                    лог запросов
    cors.js                      заголовки CORS
  utils/
    diffEngine.js                построчный diff на основе LCS
    validateDiff.js              валидация тела запроса
public/index.html                клиент-демонстрация (визуализация изменений)
requests.http                    готовые запросы для REST Client / примеры для Postman
```

## Маршруты

| Метод  | Маршрут                | Назначение                        | Успех | Ошибки   |
|--------|------------------------|-----------------------------------|-------|----------|
| GET    | `/api/diffs`           | список сравнений (+ фильтры)      | 200   | 400      |
| GET    | `/api/diffs/:id`       | одно сравнение по ID              | 200   | 404      |
| GET    | `/api/diffs/:id/patch` | unified-патч в виде `text/plain`  | 200   | 404      |
| POST   | `/api/diffs`           | создать сравнение (diff считается на сервере) | 201 | 400 |
| PUT    | `/api/diffs/:id`       | полная замена записи              | 200   | 400, 404 |
| PATCH  | `/api/diffs/:id`       | частичное обновление              | 200   | 400, 404 |
| DELETE | `/api/diffs/:id`       | удалить запись                    | 204   | 404      |
| GET    | `/health`              | состояние сервера                 | 200   | —        |
| GET    | `/api`                 | описание доступных эндпоинтов     | 200   | —        |

Параметры query для `GET /api/diffs`: `search`, `author`, `onlyChanged=true`,
`limit`, `offset`, `include=changes`.

## Формат данных

Запрос `POST /api/diffs`:

```json
{
  "title": "server.js: рефакторинг",
  "author": "student",
  "fileA": { "name": "server.old.js", "content": "строка 1\nстрока 2" },
  "fileB": { "name": "server.new.js", "content": "строка 1\nстрока 2 изменена" }
}
```

Ответ (201) дополнительно содержит рассчитанные сервером `stats` и `changes`:

```json
{
  "id": "3",
  "stats": { "added": 1, "removed": 1, "unchanged": 1, "similarity": 50, "identical": false },
  "changes": [
    { "type": "equal",   "oldLine": 1, "newLine": 1,    "content": "строка 1" },
    { "type": "removed", "oldLine": 2, "newLine": null, "content": "строка 2" },
    { "type": "added",   "oldLine": null, "newLine": 2, "content": "строка 2 изменена" }
  ]
}
```

Формат ошибок единый: `{ "error": "сообщение" }`, для ошибок валидации добавляется
массив `details`.

## Пример проверки через curl

```bash
curl -X POST http://localhost:3000/api/diffs \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"test\",\"fileA\":{\"name\":\"a.txt\",\"content\":\"line1\"},\"fileB\":{\"name\":\"b.txt\",\"content\":\"line1\nline2\"}}"
```
