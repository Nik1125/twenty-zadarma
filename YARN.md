# Шпаргалка по `yarn twenty`

Команды для разработки и деплоя Twenty App. Все запускаются из корня проекта (`twenty-zadarma/`).

## Локальный dev-сервер Twenty

`yarn twenty server …` управляет all-in-one Docker-контейнером `twentycrm/twenty-app-dev` (внутри: UI + GraphQL API + Postgres). Слушает порт **2020**. Данные хранятся в volumes `twenty-app-dev-data` и `twenty-app-dev-storage` — переживают рестарты.

```bash
yarn twenty server start    # поднять dev-инстанс (первый раз скачает образ ~несколько GB)
yarn twenty server stop     # погасить (volumes остаются)
yarn twenty server logs     # tail логов контейнера
yarn twenty server reset    # ⚠️ wipe всех данных, чистая БД
yarn twenty server status   # запущен / нет / порт
```

После `start` UI доступен на http://localhost:2020. Логин: `tim@apple.dev` / `tim@apple.dev`.

## Подключение CLI к серверу

CLI хранит список remote-инстансов в `~/.twenty/config.json`. Для локального dev:

```bash
yarn twenty remote add --local      # авто-детект порта 2020/3000, открывает браузер для авторизации
```

Для Coolify (production) добавляем отдельный remote по URL:

```bash
yarn twenty remote add --api-url https://твой-coolify-домен --as coolify
yarn twenty remote list             # посмотреть какие remotes известны
yarn twenty remote use <name>       # переключить активный remote
```

После `remote add` нужно один раз авторизоваться через UI и нажать **Authorize** — CLI получит токен.

## Разработка с live-sync

```bash
yarn twenty dev                     # watch src/, авто-пересборка и пуш на активный remote
yarn twenty dev --once              # одноразовая сборка + push, выходит со статусом (для скриптов)
```

`yarn twenty dev` доступен **только на dev-инстансах** (production такие пуши отвергает). Для production-апдейтов — `deploy`.

## Сборка и деплой на Coolify

```bash
yarn twenty build                   # компиляция в .twenty/output/, manifest.json
yarn twenty build --tarball         # дополнительно создаёт .twenty/output/twenty-zadarma-X.Y.Z.tgz
yarn twenty deploy                  # загрузить tarball на активный remote
yarn twenty install                 # установить загруженный app в активный workspace
```

Перед деплоем на прод:
```bash
yarn twenty remote use coolify      # переключить active remote
yarn twenty build --tarball
yarn twenty deploy                  # загружает на Coolify-инстанс
yarn twenty install                 # активирует в workspace
```

Если на сервере другая версия Twenty — получите `SERVER_VERSION_INCOMPATIBLE`. Чинится через `engines.twenty` в `package.json`.

## Линтинг и тесты

```bash
yarn lint                           # oxlint — быстрый, чек кода
yarn lint:fix                       # auto-fix
yarn test                           # vitest run, один прогон
yarn test:watch                     # vitest в watch-mode
```

## Типичный рабочий день

```bash
yarn twenty server start            # утром: поднять dev-инстанс
yarn twenty remote use local        # переключиться на локальный (если до этого был coolify)
yarn twenty dev                     # включить watch — все правки сами летят на dev-инстанс
# … редактируем код, смотрим в браузере на :2020 …
yarn lint && yarn test              # перед коммитом
yarn twenty server stop             # вечером: погасить контейнер
```

Деплой на Coolify (когда фича готова):

```bash
yarn lint && yarn test
yarn twenty remote use coolify
yarn twenty build --tarball
yarn twenty deploy
yarn twenty install
```

## Проблемы и диагностика

- **Порт 2020 занят** — проверь `docker ps | grep 2020` или `lsof -i :2020`. Запусти с другим: `yarn twenty server start --port 2030`.
- **`SERVER_VERSION_INCOMPATIBLE` при deploy** — версия SDK впереди сервера. Понижай `twenty-sdk` в `package.json` или поднимай Twenty на Coolify.
- **`yarn twenty dev` не видит изменения** — убедись что активный remote это `local` (`yarn twenty remote list`).
- **Webhook от Zadarma не доходит** — Zadarma серверу нужен публичный URL. Локально пробрасывай через `ngrok http 2020` и регистрируй ngrok-URL в Zadarma UI как webhook-эндпоинт.
- **Полный список команд** — `yarn twenty help` или `yarn twenty <command> --help`.
