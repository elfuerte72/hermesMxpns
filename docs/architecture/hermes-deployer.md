# Architecture: Hermes Deployer

> Технический референс для реализации. Все факты проверены по первоисточникам (см. «Sources»). Свежий агент читает этот файл + `docs/plan/hermes-deployer.md` перед стартом.

## 1. Что строим

One-click деплой Hermes Agent (Nous Research) для нетехнического клиента через Telegram Mini App. Клиент вводит bot token + LLM-провайдер + LLM-ключ → бэкенд через Hostinger API поднимает VPS с post-install script → Hermes настраивается без SSH и стартует → клиент получает работающего бота в Telegram.

## 2. Стек

| Слой             | Технология                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mini App (фронт) | React 19 + Vite + TypeScript + Tailwind CSS (мост `telegram.ts` вместо `@telegram-apps/sdk-react` — см. §14/§17) |
| Бэкенд           | NestJS (Node 20+) + TypeScript                                                                                   |
| Entry-бот        | grammY                                                                                                           |
| Hostinger-клиент | официальный `hostinger-api-sdk` (npm)                                                                            |
| БД               | PostgreSQL + Prisma                                                                                              |
| Очереди/воркеры  | BullMQ (Redis)                                                                                                   |
| SSH-recovery     | `ssh2` (запланировано; не реализовано и не в зависимостях — post-install покрыл сценарий)                        |
| Секреты          | AES-256-GCM                                                                                                      |
| Монорепо         | npm workspaces: `apps/backend`, `apps/frontend`, `packages/shared`                                               |

## 3. Hostinger API — проверенные факты

**Source:** `openapi.json` v1.2.1 из `github.com/hostinger/api`.

- **Base URL:** `https://developers.hostinger.com`
- **Auth:** `Authorization: Bearer <token>` (токен из hPanel → Profile → API; те же права, что у юзера)
- **`user_data`/cloud-init: НЕТ.** Вместо него — **post-install scripts**.

### Ключевые эндпоинты (используем в провижининге)

| Метод + путь                                           | Назначение                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/billing/v1/catalog`                          | каталог тарифов (возвращает массив, `category` фильтр=`VPS` по полю объекта, не query) |
| `GET /api/billing/v1/payment-methods`                  | способы оплаты аккаунта                                                                |
| `GET /api/vps/v1/templates`                            | список шаблонов ОС/app                                                                 |
| `GET /api/vps/v1/data-centers`                         | список дата-центров                                                                    |
| `POST /api/vps/v1/post-install-scripts`                | создать post-install script                                                            |
| `GET/PUT/DELETE /api/vps/v1/post-install-scripts/{id}` | управлять скриптом                                                                     |
| `POST /api/vps/v1/virtual-machines`                    | **purchase + setup** новой VM                                                          |
| `GET /api/vps/v1/virtual-machines`                     | список VM                                                                              |
| `GET /api/vps/v1/virtual-machines/{id}`                | детали VM (включая IP)                                                                 |
| `POST /api/vps/v1/virtual-machines/{id}/setup`         | setup купленной VM (если purchase оставил в `initial`)                                 |
| `GET /api/vps/v1/virtual-machines/{id}/actions`        | список действий/статусов (поллим до installed)                                         |
| `POST /api/vps/v1/virtual-machines/{id}/recreate`      | переустановка (принимает `template_id`, `post_install_script_id`)                      |
| `DELETE /api/vps/v1/virtual-machines/{id}`             | удалить VM                                                                             |
| `POST /api/vps/v1/virtual-machines/{id}/root-password` | сменить root-пароль (для SSH-recovery)                                                 |
| `POST /api/vps/v1/public-keys/attach/{vmId}`           | прикрепить SSH-ключ (recovery)                                                         |

### Post-install script (КЛЮЧ механики)

`POST /api/vps/v1/post-install-scripts`, body = `VPS.V1.PostInstallScript.StoreRequest` (`name`, `content`).
Из описания: _script contents saved to `/post_install` with executable bit, executed once after VM install, output → `/post_install.log`, max 48KB._

- Скрипт сохраняется в **аккаунте Hostinger** (виден всем, у кого есть токен аккаунта) → **секреты в скрипт класть НЕЛЬЗЯ**. См. §6 (bootstrap pull).
- После установки VM скрипт нужно удалить (`DELETE /post-install-scripts/{id}`) — гигиена.

### `POST /api/vps/v1/virtual-machines` (purchase)

Body = `VPS.V1.VirtualMachine.PurchaseRequest`:

```
{
  "item_id": "hostingercom-vps-kvm1-usd-1m",   // тариф из каталога
  "payment_method_id": 1234,                    // опционально, дефолтный если не указан
  "setup": {                                    // VPS.V1.VirtualMachine.SetupRequest
    "template_id": 1121,                        // ОБЯЗАТЕЛЬНО
    "data_center_id": 11,                       // ОБЯЗАТЕЛЬНО
    "post_install_script_id": 6324,             // наш скрипт
    "password": "...",                          // опц., иначе случайный (не возвращается)
    "hostname": "...",                          // опц.
    "public_key": { "name": "...", "key": "ssh-..." },  // опц., для SSH-recovery
    "install_monarx": false,
    "enable_backups": true
  }
}
```

`item_id` — это **price item id** из `prices[]` элемента каталога (не `id` тарифа). Пример: тариф `hostingercom-vps-kvm1` имеет `prices[]` с `id: "hostingercom-vps-kvm1-usd-1m"` (monthly), `...-usd-1y` (yearly).
**Purchase списывает реальные деньги с аккаунта оператора.**

## 4. Решённые IDs (из живых запросов к API)

| Что               | Значение                        | Примечание                                                                  |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Template          | `1121`                          | Ubuntu 24.04 with Docker (Docker предустановлен)                            |
| Data center       | `11`                            | Vilnius, Lithuania (`lt`) — ближайший к РФ. Fallback: `19` Frankfurt (`de`) |
| Тариф             | KVM 1 (`hostingercom-vps-kvm1`) | 1 vCPU, 4096 MB RAM, 50 GB NVMe, 300 Mbps                                   |
| item_id (monthly) | `hostingercom-vps-kvm1-usd-1m`  | renewal $19.49/мес; first-month промо $9.99                                 |
| item_id (yearly)  | `hostingercom-vps-kvm1-usd-1y`  | $155.88/год = $12.99/мес эфф.                                               |

Готового Hermes-template в API **нет**. Другие полезные шаблоны (на будущее): `1007` Ubuntu 22.04, `1077` Ubuntu 24.04 LTS, `1210` Ubuntu 24.04 with Docker and Traefik.

## 5. Hermes Agent — настройка (docker)

**Source:** `/nousresearch/hermes-agent` (Context7, репутация High).

- **Образ:** `nousresearch/hermes-agent:latest`
- **Команда:** `gateway run`
- **Порты:** `8642` (gateway API), `9119` (dashboard, только при `HERMES_DASHBOARD=1`)
- **Volume:** `~/.hermes:/opt/data` (конфиг и данные персистятся на хосте)
- **Базовый docker-compose** (из доков):

```yaml
services:
  hermes:
    image: nousresearch/hermes-agent:latest
    restart: unless-stopped
    command: gateway run
    ports: ['8642:8642', '9119:9119']
    volumes: ['~/.hermes:/opt/data']
    environment:
      - HERMES_DASHBOARD=1
    deploy:
      resources:
        limits: { memory: 4G, cpus: '2.0' } # ← ВНИМАНИЕ: на KVM 1 (4GB) снизить до ~3G
```

⚠️ **Тюнинг под KVM 1 (4GB):** в генерируемом compose снизить `memory` лимит до ~`3G` (оставить голову под OS + Docker daemon ~1GB). Иначе OOM-killer.

### Конфиг Telegram (пишем в `~/.hermes/.env`)

```
TELEGRAM_BOT_TOKEN=<от клиента>
TELEGRAM_ALLOWED_USERS=<telegram_id клиента, через запятую>
<GROQ|GEMINI|OPENROUTER|...>_API_KEY=<LLM-ключ клиента>
HERMES_DASHBOARD=1
```

### Конфиг LLM-провайдера (пишем в `~/.hermes/config.yaml`)

```yaml
custom_providers:
  - name: <provider> # groq | gemini | openrouter | together | custom
    base_url: <base_url> # из §7
    key_env: <KEY_ENV> # имя env-переменной с ключом
model:
  default: <default_model>
  provider: custom:<provider>
```

Hermes поддерживает несколько `custom_providers` одновременно + `fallback_providers`.

## 6. Безопасность: доставка секретов (КРИТИЧНО)

> ⚠️ **Заменено 2026-07-05: Docker Manager API.** Механика bootstrap-pull ниже выпилена из кода — секреты теперь доставляются напрямую через Hostinger Docker Manager API, без post-install script, `/bootstrap` и `/webhooks/deploy-ready`. См. §19. Текст сохранён для истории.

**Проблема:** post-install script хранится в аккаунте Hostinger (виден любому с токеном аккаунта). Класть туда bot token / LLM-ключ нельзя.
**Решение — bootstrap pull:**

1. При создании деплоя бэкенд генерирует **одноразовый bootstrap-токен** (рандомный), в БД хранится только `hash`.
2. Post-install script идёт **без секретов** — содержит только: `curl <BACKEND_URL>/bootstrap/<deploy_id>?token=<one-time>`.
3. VPS после установки дёргает этот URL. Бэкенд проверяет: токен валиден (hash) + не использован + **IP звонящего = IP VM** (из `GET /virtual-machines/{id}`).
4. При успехе бэкенд отдаёт `{ bot_token, llm_provider, llm_key, config_yaml }` (расшифрованные), **инвалидирует токен**.
5. Скрипт пишет `~/.hermes/.env` + `config.yaml` + `docker-compose.yml`, делает `docker compose up -d`, затем `POST <BACKEND_URL>/webhooks/deploy-ready` (подписан одноразовым секретом из того же bootstrap-пэйлоада).

- Replay-защита: токен горит после 1-го использования.
- Fallback если IP-проверка ломается (NAT/IPv6): подписанный one-time JWT вместо IP-проверки (отложить до реального теста — см. риски в плане).

## 7. Каталог LLM-провайдеров (проверенные base_url)

**Source:** `/nousresearch/hermes-agent` (providers.md, google-gemini guide) + `/openclaw/openclaw` (openrouter.md). Все OpenAI-compatible.

| id           | name                          | base_url                                                   | key_env              | default_model                             |
| ------------ | ----------------------------- | ---------------------------------------------------------- | -------------------- | ----------------------------------------- |
| `groq`       | Groq (бесплатно)              | `https://api.groq.com/openai/v1`                           | `GROQ_API_KEY`       | `llama-3.3-70b-versatile`                 |
| `gemini`     | Google Gemini (free tier)     | `https://generativelanguage.googleapis.com/v1beta/openai/` | `GEMINI_API_KEY`     | `gemini-1.5-flash`                        |
| `openrouter` | OpenRouter (есть free models) | `https://openrouter.ai/api/v1`                             | `OPENROUTER_API_KEY` | (выбор клиента)                           |
| `together`   | Together AI                   | `https://api.together.xyz/v1`                              | `TOGETHER_API_KEY`   | `meta-llama/Llama-3.1-70B-Instruct-Turbo` |
| `custom`     | Свой (OpenAI-compatible)      | (ввод клиента)                                             | `CUSTOM_API_KEY`     | (ввод клиента)                            |

Mini App даёт меню выбора; бэкенд подставляет правильный `base_url` + `key_env` в `config.yaml`.

## 8. Модель данных (Prisma)

```
User(telegram_id PK, username, created_at)
Deploy(
  id PK, user_id FK, agent default 'hermes',
  bot_token_enc, bot_username,
  llm_provider, llm_key_enc,
  hostinger_vm_id, hostinger_script_id,
  status enum(pending, creating, configuring, ready, failed, deleted),
  bootstrap_token_hash, bootstrap_used_at, vm_ip,
  paid_until, created_at, updated_at
)
ProvisioningLog(id PK, deploy_id FK, step, status, message, ts)
Subscription/Payment — phase 2 (billing)
```

Секреты (`bot_token_enc`, `llm_key_enc`) — AES-256-GCM шифртекст. `bootstrap_token_hash` — hash одноразового токена (не сам токен).

## 9. API бэкенда

```
POST /auth/validate-init            — TMA initData → { user }   (auth)
GET  /llm-providers                 — каталог провайдеров
POST /validate-bot-token            — прокси к Telegram getMe → { username, id }
POST /deploys                       — создать деплой → 202 { deploy_id }   (auth)
GET  /deploys                       — список деплоев юзера   (auth)
GET  /deploys/:id                   — статус деплоя   (auth)
DELETE /deploys/:id                 — teardown → 202   (auth)
GET  /bootstrap/:deploy_id?token=…  — one-time выдача секретов VPS (IP-проверка)
POST /webhooks/deploy-ready         — от VPS после старта Hermes
```

## 10. Flow деплоя (с реальными эндпоинтами)

1. Mini App: форма → `POST /validate-bot-token` (Telegram getMe) → выбор провайдера + ключ → `POST /deploys`.
2. Бэкенд: шифрует секреты, создаёт `Deploy(pending)` + одноразовый bootstrap-токен (hash в БД), ставит BullMQ-job `deploy`.
3. Воркер `deploy`:
   a. `POST /api/vps/v1/post-install-scripts` — создаёт скрипт (без секретов, с bootstrap-URL + docker-compose генерацией).
   b. `POST /api/vps/v1/virtual-machines` с `setup{template_id:1121, data_center_id:11, post_install_script_id}`.
   c. Поллит `GET /api/vps/v1/virtual-machines/{id}/actions` до installed. Записывает `hostinger_vm_id`, `vm_ip`.
4. На VPS `/post_install` выполняется: `GET /bootstrap/:id?token=…` (тянет секреты, IP-проверка) → пишет `~/.hermes/.env` + `config.yaml` + `docker-compose.yml` (memory limit ~3G) → `docker compose up -d` → `POST /webhooks/deploy-ready`.
5. Бэкенд: инвалид bootstrap-токен, `status=ready`, `DELETE /post-install-scripts/{id}` (гигиена), бот шлёт клиенту «готово, напиши @botusername».
6. Сбой любого шага → `DELETE /virtual-machines/{id}` (если создан) + `DELETE /post-install-scripts/{id}` + `status=failed` + уведомление.

## 11. Teardown flow

`DELETE /deploys/:id` → BullMQ-job `teardown`: `DELETE /api/vps/v1/virtual-machines/{id}` + `DELETE /api/vps/v1/post-install-scripts/{id}` → `status=deleted` + уведомление. Идемпотентно.

## 12. Control-plane

Один микро-VPS оператора: NestJS-бинарник + Postgres + Redis (docker compose). Клиентские VPS — Hostinger, по требованию. `(BACKEND_URL)` должен быть публично доступен (для webhook'ов и bootstrap-pull с клиентских VPS) — HTTPS обязательно.

## 13. Sources

- Hostinger API spec: `openapi.json` v1.2.1, https://github.com/hostinger/api (README → openapi.json; эндпоинты/схемы сверены по строкам: post-install-scripts 4725, virtual-machines purchase 5326, SetupRequest 8424, PurchaseRequest 8333)
- Hermes Agent docs: Context7 `/nousresearch/hermes-agent` (install, docker, telegram.md, providers.md, google-gemini guide)
- OpenClaw docs (cross-check OpenRouter): Context7 `/openclaw/openclaw` (providers/openrouter.md, channels/telegram.md)
- Live API queries (catalog, data-centers, templates) через токен оператора — 2026-07-04

## 14. Phase 1 implementation findings (verified 2026-07-04)

> Дополнения к §2/§3, выявленные при реализации. Sourced, не догадки.

### Prisma 7 (мажорные изменения vs «классического» Prisma 5/6)

- **Driver adapter обязателен.** `new PrismaClient()` без adapter кидает `P2038`. Используем `@prisma/adapter-pg` (`PrismaPg`) с `connectionString = DATABASE_URL`. `pg` и `@types/pg` тянутся transitively через adapter (отдельно ставить не нужно).
- **`url` убран из `datasource` в schema.** Connection URL для Migrate живёт в `prisma.config.ts` (`datasource: { url: env<Env>('DATABASE_URL') }`). Файл `apps/backend/prisma.config.ts` грузит root `.env` (walk-up) — `env()` из `prisma/config` НЕ подгружает `.env` сам.
- **Generator `prisma-client`** (новый), `output = "../src/generated/prisma"` → TS-исходники, импорт `import { PrismaClient } from '../generated/prisma/client'` (нет `index.ts`). Каталог в `.gitignore`. Команды `npx prisma migrate dev` / `npx prisma generate` работают из `apps/backend` (как в AGENTS).
- `@nestjs/config` `validate` бежит при import-eval `ConfigModule.forRoot` (до тела `main.ts`) → root `.env` грузится side-effect импортом `./env` первым в `main.ts`; в forRoot стоит `ignoreEnvFile: true`.

### hostinger-api-sdk@1.2.1 — gap по deleteVM

- SDK **не экспортирует** метод удаления VM (в `VPSVirtualMachineApi` нет `deleteVirtualMachine*`). Все DELETE-методы в SDK — для других ресурсов (payment-methods, post-install-scripts, snapshots, PTR, projects).
- `DELETE /api/vps/v1/virtual-machines/{id}` (§3) существует по openapi.json, но SDK его не генерирует. `ProvisioningService.deleteVM(id)` делает **raw `axios.delete`** на `https://developers.hostinger.com/api/vps/v1/virtual-machines/{id}` с `Authorization: Bearer <token>`.
- **Требует верификации на реальном деплое** (Checkpoint 3): подтвердить, что endpoint отвечает 2xx и VM действительно удаляется. Если нет — альтернатива: отмена подписки (`BillingSubscriptionsApi` имеет только `disableAutoRenewalV1`, без cancel/delete — тоже требует уточнения у Hostinger).

### Прочее

- Purchase-ответ (`BillingV1OrderVirtualMachineOrderResource`) содержит `virtual_machine` напрямую → VM id доступен сразу после purchase (не нужно искать через `listVMs`).
- VM state — поле `state` (enum: running/creating/initial/error/...), у Action — `state` (success/error/delayed/sent/created). «installed» в API нет — воркер (Task 12) должен поллить VM `state`→running и/или actions.
- Версии стека (актуальные на 2026-07-04): Node 22, NestJS 11, TS 6, Vite 8, React 19 (док говорил 18 — SDK `@telegram-apps/sdk-react` поддерживает 19), Tailwind 4 (CSS-first, `@tailwindcss/vite`), Prisma 7, zod 4, grammY 1.44.
- TS 6 депрекейтит `moduleResolution: node` (Node10) → CJS-пакеты (backend, shared) используют `ignoreDeprecations: "6.0"`; frontend — `moduleResolution: bundler`.
- `npm audit`: `@telegram-apps/sdk-react@3.3.9` транзитивно тянет deprecated `@tma.js/*` с уязвимым `valibot` (ReDoS в `EMOJI_REGEX`, GHSA-vqpr-j7v3-hqw9; 9 high). `npm audit fix --force` = breaking downgrade к sdk-react v2. Не блокирует Phase 1 (SDK не используется до Task 5). Переоценить при реализации TMA-auth (Task 5): возможна миграция на `@tma.js/sdk-react` или фикс upstream.

## 15. Phase 2 implementation findings (verified 2026-07-04)

> Sourced-факты, выявленные при реализации Tasks 5–8.

### TMA initData validation (Task 5) — алгоритм из официальных доков

**Source:** https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app (Bot API 9.6, 2026-04-03).

- `initData` — это query string (URL-encoded). Валидация HMAC-SHA256:
  1. Распарсить `initData` через `URLSearchParams` (значения URL-decoded).
  2. Достать `hash`; убрать его из набора параметров.
  3. `data_check_string` = все остальные поля, отсортированные по ключу alphabetically, в формате `key=value`, разделённые `\n` (0x0A). **Значения — decoded** (то, что вернул `URLSearchParams.get`).
  4. `secret_key = HMAC_SHA256(key="WebAppData", message=<bot_token>)`.
  5. `computed_hash = hex(HMAC_SHA256(key=secret_key, message=data_check_string))`.
  6. `computed_hash === hash` → данные от Telegram.
- `auth_date` — Unix-секунды; опциональная freshness-проверка (`now - auth_date <= max_age`). Реализовано через env `TMA_AUTH_MAX_AGE_SECONDS` (дефолт 86400 = 24ч).
- `user` — JSON-serialized `WebAppUser`; `id` — до 52 значащих бит → храним как `BigInt` (Prisma `telegram_id BigInt`). `signature` (поле для third-party Ed25519-валидации) присутствует в реальном initData и **входит** в `data_check_string` (исключается только `hash`).
- Реализация: `apps/backend/src/auth/tma-validation.ts` (pure functions, без NestJS-зависимостей — легко тестировать); `buildInitData()` хелпер для тестов генерирует валидную строку.
- Auth-контракт: фронт шлёт `Authorization: tma <initData>` на защищённые эндпойнты; `TmaAuthGuard` (NestJS `CanActivate`) валидирует подпись + freshness, кладёт user в `request.tmaUser`. Stateless — без JWT/сессий, initData ре-валидируется на каждом запросе (HMAC дёшево). `POST /auth/validate-init` — отдельно (initData в body), upsert'ит `User`.
- DTO-валидация: кастомный `ZodValidationPipe` (zod уже в deps) вместо class-validator — консистентно с `env.schema.ts`.

### grammY 1.44 (Task 6) — entry bot

**Source:** grammY docs (Context7 `/websites/grammy_dev`, репутация High).

- `InlineKeyboard.webApp(text, url)` → кнопка с `web_app: { url }` (открывает Mini App). Проверено по `node_modules/grammy/out/convenience/keyboard.d.ts:576`.
- Транспорт через env `BOT_USE_WEBHOOK` (default `false` = long polling): `false` → `bot.start()`; `true` → `bot.api.setWebhook(${BACKEND_URL}/bot/${BOT_TOKEN})` + `webhookCallback(bot, 'express')` на `POST /bot/:secret` (secret = BOT_TOKEN). Webhook-path-with-token — рекомендация grammY (Telegram шлёт только на этот секретный путь).
- ⚠️ `webhookCallback(bot, ...)` вызывает `bot.isRunning()` и **перезаписывает `bot.start`** (кидает, если вызвать после webhook-setup). Тесты должны захватывать ссылку на `bot.start` до `onModuleInit`, а мок-бот должен иметь `isRunning: () => false`.
- Пустой `BOT_TOKEN` → `BotService` no-op (WARN-лог), приложение стартует. Реальный entry-бот ещё не создан (TODO в `.env`).
- `@types/express` добавлен в devDeps (нужен для типов `Request`/`Response` в `BotController` вебхука).

### validate-bot-token (Task 8)

- Прокси к Telegram `GET https://api.telegram.org/bot<token>/getMe` через `axios`. Невалидный токен → Telegram 401 → axios rejects → `422 UnprocessableEntityException`. `ok:false` / не-бот → тоже 422.
- Уникальность: токены зашифрованы в БД (`bot_token_enc`), ищем по `bot_username` (уникально идентифицирует бота). Блокируем только активные деплои (`status in pending/creating/configuring/ready`); `failed`/`deleted` не блокируют повторный деплой. Конфликт → `409 ConflictException`.
- Эндпойнт под `TmaAuthGuard` (auth-контекст Task 5).

### Прочее (Phase 2)

- Полная статистика Phase 2: 13 test suites, 72 теста (было 23 в Phase 1). `npm run build`/`lint`/`typecheck` зелёные. Smoke-тест: валидный initData → 200 + upsert в Postgres, tampered hash → 401, `validate-bot-token` под валидным TMA-auth → 422 (фейк-токен).

## 16. Phase 3 implementation findings (Tasks 9–11, verified 2026-07-04)

> Уточнения к §6/§9/§10, принятые при реализации deploy happy-path.

### Task 9 — `POST /deploys`

- Очередь — порт `DeployQueue` (абстрактный класс) + BullMQ-реализация (`bullmq`+`ioredis` добавлены). `jobId = deployId` → идемпотентность; exponential backoff, 3 попытки. `parseRedisConnection(REDIS_URL)` отдаёт connection-options (не ioredis-инстанс) — иначе конфликт типов с ioredis, который тянет сам BullMQ. Тесты инжектят фейковую очередь (Redis не нужен).
- `create()` переиспользует `ValidateBotTokenService.validate` (getMe + single-active-deploy → 422/409), upsert'ит `User` (FK-safety), шифрует оба секрета, пишет `Deploy(pending)` только с `_enc` колонками + `bootstrap_token_hash`. Plaintext bootstrap-токен уезжает **только** в job payload (Redis, internal).
- Схема: добавлены nullable `llm_base_url` / `llm_model` (для openrouter/custom, где base_url/model приходят от клиента). DTO требует их для `custom`.

### Task 10 — post-install script generator

- Скрипт **не рендерит** секреты и провайдер-специфику — только тянет одноразовый `BootstrapPayload` и пишет файлы. Значения single-quote-escaped, валидность проверяется `bash -n` в тесте. jq ставится по требованию.

### Task 11 — bootstrap pull (уточнение §6)

- Бэкенд отдаёт **отрендеренные файлы** `{ env, config_yaml, compose, webhook_secret }`, а не сырые `{ bot_token, llm_key, ... }`. Рендер (`provisioning/hermes-config.ts`, чистые функции по §5/§7) на бэкенде → в bash нет опасного экранирования секретов, compose с `memory: 3G` (KVM 1).
- IP-проверка — против сохранённого `deploy.vm_ip` (пишет воркер, Task 12), а не живого `getVM` на каждый запрос. `resolveClientIp` берёт первый хоп `X-Forwarded-For` (бэкенд за HTTPS-термином), нормализует `::ffff:` → IPv4.
- Одноразовость: атомарный `updateMany({where:{id, bootstrap_used_at:null}})` — гонку выигрывает первый. Webhook-секрет генерится здесь, в БД только `webhook_secret_hash` (новая колонка), plaintext уходит в payload для Task 13.

### Task 12 — deploy worker (BullMQ)

- Логика вынесена в чистый `DeployProcessor` (юнит-тест с замоканным SDK); тонкий `DeployWorker` (bullmq `Worker`) только дергает его. Env `DEPLOY_WORKER_ENABLED` (default true) — можно поднять API-only ноду.
- Идемпотентность: атомарный claim `updateMany({where:{status:'pending'}, data:{status:'creating'}})` — повторный/параллельный запуск получает count 0 и выходит. Воркер доводит до `configuring` (VM `running`, `vm_ip` записан); в `ready` переводит webhook от VPS (Task 13).
- `DRY_RUN=true` → воркер НЕ делает ни одного платного вызова (даже claim), только пишет `dry_run` в лог. Реальный деплой — `DRY_RUN=false` под чекпойнтом. Тариф/템플ейт/DC зашиты константами (`hostingercom-vps-kvm1-usd-1m`, 1121, 11).
- Поллинг VM: `getVM` каждые 10s до `running` (или `error`/таймаут ~10 мин), `sleep` инжектируемый (тесты — no-op).
- Fail-path: пишет `error` в лог, удаляет VM (если создан) + post-install script (cleanup-ошибки глотаются, но не мешают), `status=failed`, `DeployNotifier.deployFailed`. Ретраи с backoff — отложены в Task 18; сейчас fail терминален (без re-throw → без повторной покупки). Orphan при краше mid-purchase → reconciliation (Task 17).

### Task 13 — webhook /deploy-ready + нотификатор

- `POST /webhooks/deploy-ready` (без TmaAuthGuard — auth = Bearer webhook-секрет). Проверка подписи: `bootstrapTokenMatches(secret, webhook_secret_hash)` (тот же constant-time hash-compare). Невалид/нет deploy/нет секрета → 404.
- Переход `creating|configuring → ready` через guarded `updateMany`; повтор для `ready` → идемпотентно 200; терминальный не-ready (failed/deleted) → 404. Гигиена: `deletePostInstallScript(hostinger_script_id)` best-effort (скип под DRY_RUN), нотификация клиенту.
- `DeployNotifier` — общий порт (`workers/deploy-notifier.ts`), бот-реализация `notifications/BotDeployNotifier` (DM через `BotService.sendMessage`, no-op если `BOT_TOKEN` пуст). `NotificationsModule` провайдит его для воркера и вебхука.
- **Итог Phase 3:** 27 suites / 146 тестов зелёные; DI-граф и роуты (`/deploys`, `/bootstrap/:id`, `/webhooks/deploy-ready`) проверены smoke-бутом. Реальный деплой (`DRY_RUN=false`) — под чекпойнтом с человеком.

## 17. Phase 4 implementation findings (Tasks 14–15 + read API)

- Бэкенд: `GET /deploys` и `GET /deploys/:id` (owner-scoped, `toDeployView` — только публичные поля, без `_enc`/хешей). 404 если чужой/нет.
- Frontend (`apps/frontend/src`): вместо `@telegram-apps/sdk-react` (у него уязвимые транзитивы, см. §14) — тонкий мост `telegram.ts` над `window.Telegram.WebApp` (raw initData → `Authorization: tma <initData>`; dev-fallback `VITE_DEV_INIT_DATA`). Скрипт `telegram-web-app.js` подключён в `index.html`.
- `api.ts` — fetch-обёртка (`VITE_API_URL` base, `ApiError` со статусом/сообщением). `DeployForm` (валидация bot-token → username, custom-провайдер даёт base_url+model), `DeployStatusView` (поллинг `GET /deploys/:id` каждые 3с, стоп на terminal, ready→`t.me/<bot>`, failed→reset). Секреты в UI не хранятся после ввода; статус тянет `DeployView` без секретов.
- Тестирование фронта: **vitest** (jsdom) добавлен — 15 тестов на чистую логику (api-клиент с моком fetch, telegram-мост, статус-хелперы). Корневой `npm test` теперь гоняет backend (jest) + frontend (vitest). Итог Phase 4: 152 backend + 15 frontend тестов зелёные, `npm run build` собирает TMA (~200KB/63KB gzip).

## 18. Phase 5 implementation findings (Tasks 16–18) — MVP код-комплит

- **Task 16 (teardown):** `DELETE /deploys/:id` (owner-checked, 202) → `TeardownQueue` (BullMQ, jobId `teardown-<id>`) → `TeardownProcessor` (deleteVM + deleteScript best-effort, `status=deleted`, notify). Идемпотентно: уже `deleted` → не ставит job. DRY_RUN пропускает реальные удаления. `DeployNotifier.deployDeleted` добавлен.
- **Task 17 (reconcile):** `@nestjs/schedule` `ScheduleModule.forRoot()` в WorkersModule. `ReconcileScheduler` @Cron 03:00 → `ReconcileService`: сверяет `listVMs` vs активные deploys → orphan-VM (в т.ч. под `deleted`-deploy) и «пропавшие» VM активных deploys. Alert-only; удаление orphan'ов за `RECONCILE_DELETE_ORPHANS` (никогда под DRY_RUN).
- **Task 18 (resilience):** `common/retry.ts` `withRetry` — exponential backoff на 429/5xx/сеть, 4xx фатально; применён в воркере к `getVM` (поллинг переживает блипы), `createPostInstallScript`, cleanup-удалениям. `purchaseVM` НЕ ретраится (деньги). Watchdog `StuckDeployService` (@Cron каждые 5 мин): deploys в `creating/configuring` старше 20 мин (> 10-мин poll воркера, чтобы не гоняться за живым) → `failed` + cleanup + notify. Закрывает «configuring навсегда, если webhook не пришёл».
- **Итог MVP (Phases 1–5):** 31 backend suites / 183 теста + 15 frontend = **198 тестов**, build/lint/typecheck зелёные. DI-граф, HTTP-роуты и cron-джобы проверены smoke-бутом. Остаётся: реальный деплой под чекпойнтом (`DRY_RUN=false`) и Phase 6 (billing, open questions).

## 19. Docker Manager refactor (2026-07-05) — замена bootstrap-pull

> Заменяет §6 и шаги 3a/4/5 из §10. Sourced: `hostinger-api-sdk@1.2.1` (`VPSDockerManagerApi`, api.d.ts: createNewProjectV1 / getProjectContainersV1 / deleteProjectV1, `VPSV1VirtualMachineDockerManagerUpRequest {project_name, content, environment}`).

- **Мотивация:** Hostinger Docker Manager API позволяет запушить docker-compose проект на VPS напрямую (`POST .../docker/{vmId}/up` через SDK `createNewProjectV1`), без post-install script, без публичного `/bootstrap` (one-time токен + IP-проверка) и без `/webhooks/deploy-ready`. Меньше движущихся частей: секреты не проходят через bash, воркер сам доводит деплой до `ready`.
- **Новый флоу воркера (`workers/deploy.processor.ts`):**
  1. claim `pending→creating` (guarded `updateMany`, как раньше);
  2. `purchaseVM` **без** `post_install_script_id` (скрипты вообще не создаются, `VPSPostInstallScriptsApi` из обёртки удалён);
  3. поллинг `getVM` до `running` → записать `hostinger_vm_id`/`vm_ip`, `creating→configuring`;
  4. расшифровать секреты (`SecretsService` в воркере), отрендерить `env`/`config.yaml`/`compose` (те же чистые функции `provisioning/hermes-config.ts`) → `ProvisioningService.createDockerProject(vmId, "hermes-<deployId>", composeYaml, envContent)`. `environment` = содержимое project-`.env` (секреты); compose секретов не содержит: `config.yaml` едет inline compose-`configs` (`content:` → target `/opt/data/config.yaml`, требует Compose ≥2.23.1 — на template 1121 проверить в чекпойнте), env уходит в контейнер через `env_file: .env`;
  5. поллинг `getDockerProjectContainers` до `state=running` (таймаут ~10 мин; ранние 404/422 после `createNewProjectV1` толерируются — проект появляется асинхронно; `exited`/`dead` = фейл) → guarded `configuring→ready` + `DeployNotifier.deployReady`;
  6. любой сбой → cleanup `deleteVM` (если создан), `status=failed`, лог в `ProvisioningLog`, notify. `purchaseVM` по-прежнему не ретраится; `createDockerProject`/поллинг — `withRetry` на 429/5xx/сеть.
- **Выпилено:** `src/bootstrap/**` (pull + client-ip), `src/webhooks/**`, `provisioning/script-generator*`, `deploys/bootstrap-token*`; shared-типы `BootstrapPayload`/`DeployReadyRequest`/`DeployReadyResponse`/`HostingerPostInstallScript`; колонки Deploy `bootstrap_token_hash`/`bootstrap_used_at`/`webhook_secret_hash`/`hostinger_script_id` (миграция `drop_bootstrap_webhook_fields`). Teardown/watchdog чистят только VM. `DeployJobData` = `{deployId}` — секретов и токенов в Redis больше нет.
- **Trade-off (осознанный):** секреты (project `.env`) проходят через Hostinger API и видны в Docker Manager владельцу аккаунта Hostinger — приемлемо, т.к. оператор и так владеет VPS клиента; зато нет публичных небезопасных эндпойнтов на бэкенде. `BACKEND_URL` остаётся только для бот-вебхука.
