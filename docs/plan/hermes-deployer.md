# Implementation Plan: Hermes Deployer

## Overview

One-click деплой Hermes-агента для нетехнического клиента через Telegram Mini App. **One-click bundle (Phase 6):** клиент платит подписку (Tribute, рубли) → бэкенд создаёт managed OpenRouter-ключ (spend-cap) и разворачивает Hermes на Hostinger VPS через Docker Manager API → клиент получает работающего бота без VPS/SSH/терминала и без похода за API-ключом. Bot token клиент создаёт сам в @BotFather. Стек: Node/TS (NestJS + grammY + Prisma + hostinger-api-sdk) + React/Vite TMA. Спека — `docs/architecture §23`.

## Architecture Decisions

- **Hostinger post-install scripts** вместо cloud-init (verified: `openapi.json` v1.2.1). SSH — только recovery.
- **Pull-доставка секретов**: post-install script без секретов, VPS тянет их с бэкенда по one-time bootstrap-токену + IP-проверка. Иначе секреты видны в account-scoped скрипте Hostinger.
- **Вертикальные срезы**: каждая задача = работающий тестируемый путь, а не «весь слой сразу».
- **Монорепо**: `apps/backend` (NestJS), `apps/frontend` (Vite React TMA), `packages/shared` (типы).
- **Очереди**: BullMQ (Redis) для асинхронных деплоев/тирдауна/реконсиляции.
- **Шифрование секретов**: AES-256-GCM at rest (bot tokens, LLM-ключи).

## Task List

### Phase 1: Foundation

#### Task 1: Monorepo scaffold

**Description:** Поднять монорепо с тремя пакетами, общим tsconfig, eslint/prettier, git-инитом, скриптами build/dev.
**Acceptance criteria:**

- [x] `apps/backend` (NestJS) собирается и стартует на :3000
- [x] `apps/frontend` (Vite + React + TS) собирается и отдаёт index.html
- [x] `packages/shared` экспортирует хотя бы один тип и реэкспортится из обоих приложений
- [x] `npm run build` и `npm run lint` зелёные на корне
      **Verification:** `npm run build` с корня; `npm run dev` поднимает оба дев-сервера.
      **Dependencies:** None
      **Files likely touched:** `package.json`, `tsconfig.base.json`, `apps/backend/**`, `apps/frontend/**`, `packages/shared/**`, `.eslintrc`, `.prettierrc`
      **Estimated scope:** Medium (scaffold, много мелких файлов)

#### Task 2: Prisma schema + local infra

**Description:** Схема `User`, `Deploy`, `ProvisioningLog`; docker-compose для локальных Postgres + Redis; первая миграция.
**Acceptance criteria:**

- [x] `prisma migrate dev` накатывает схему без ошибок
- [x] Сгенерированы TS-типы Prisma
- [x] `docker compose up` поднимает Postgres + Redis
- [x] Модели: `User(telegram_id, username)`, `Deploy(user_id, agent, bot_token_enc, bot_username, llm_provider, llm_key_enc, hostinger_vm_id, hostinger_script_id, status, bootstrap_token_hash, paid_until, timestamps)`, `ProvisioningLog(deploy_id, step, status, message, ts)`
      **Verification:** `npx prisma migrate dev && npx prisma generate`; `docker compose up -d` → psql видит таблицы.
      **Dependencies:** Task 1
      **Files likely touched:** `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/**`, `docker-compose.yml`, `apps/backend/src/prisma/**`
      **Estimated scope:** Small

#### Task 3: Secrets + Config modules

**Description:** `SecretsModule` (AES-256-GCM encrypt/decrypt), `ConfigModule` (zod-валидация env: DATABASE_URL, REDIS_URL, HOSTINGER_API_TOKEN, BOT_TOKEN, ENCRYPTION_KEY, BACKEND_URL, MINI_APP_URL).
**Acceptance criteria:**

- [x] `encrypt(plaintext)` → `decrypt(ciphertext)` round-trip совпадает
- [x] Разные шифртексты для одинаковых плейнтекстов (рандомный IV)
- [x] Приложение падает с понятной ошибкой при отсутствии обязательного env
- [x] Юнит-тесты на encrypt/decrypt/replay
      **Verification:** `npm test -- secrets`.
      **Dependencies:** Task 1
      **Files likely touched:** `apps/backend/src/secrets/**`, `apps/backend/src/config/**`, `apps/backend/test/secrets.spec.ts`
      **Estimated scope:** Small

#### Task 4: Hostinger SDK client wrapper

**Description:** `ProvisioningModule` — обёртка над официальным `hostinger-api-sdk`: методы для catalog, templates, data-centers, post-install-scripts (CRUD), virtual-machines (purchase/get/actions/delete). Типы в `packages/shared`.
**Acceptance criteria:**

- [x] SDK установлен, типизированный клиент инстанцируется из `HOSTINGER_API_TOKEN`
- [x] Методы-обёртки: `listTemplates()`, `listDataCenters()`, `getCatalog()`, `createPostInstallScript(name, content)`, `deletePostInstallScript(id)`, `purchaseVM(setup)`, `getVM(id)`, `listActions(vmId)`, `deleteVM(id)`
- [x] Моки для тестов; один интеграционный тест (опционально, против боевого токена — за флагом) — моки есть, интеграционный отложен на Checkpoint 3 (реальный деплой)
      **Verification:** `npm test -- provisioning`; мок-тесты зелёные.
      **Dependencies:** Task 1, Task 3 (необязательно, но env)
      **Files likely touched:** `apps/backend/src/provisioning/**`, `packages/shared/src/hostinger.ts`, `apps/backend/test/provisioning.spec.ts`
      **Estimated scope:** Medium

### Checkpoint: Foundation

- [x] `npm run build` зелёный на корне
- [x] Миграции накатываются, Postgres/Redis поднимаются
- [x] Шифрование работает (тесты)
- [x] Hostinger-клиент собирается (мок-тесты)
- [x] Ревью с человеком перед Phase 2

### Phase 2: Identity & input validation slice

#### Task 5: TMA Auth module

**Description:** Валидация Telegram Mini App `initData` (HMAC-SHA256 с BOT_TOKEN), извлечение `telegram_id`, upsert `User`.
**Acceptance criteria:**

- [x] `POST /auth/validate-init` принимает `initData`, проверяет подпись, возвращает `{ user }`
- [x] Невалидная подпись → 401
- [x] Юзер upsert'ится в БД по `telegram_id`
- [x] Юнит-тесты на валидацию подписи (валидный/невалидный/expired)
      **Verification:** `npm test -- auth`; curl с тестовым initData.
      **Dependencies:** Task 2
      **Files likely touched:** `apps/backend/src/auth/**`, `apps/backend/test/auth.spec.ts`
      **Estimated scope:** Small

#### Task 6: grammY entry bot

**Description:** Бот отвечает на `/start` кнопкой-WebApp, открывающей Mini App URL. Позже — канал уведомлений о статусе деплоя.
**Acceptance criteria:**

- [x] Бот стартует с `BOT_TOKEN`, отвечает на `/start`
- [x] Кнопка открывает `MINI_APP_URL`
- [x] Длинные polling/Webhook — выбирается через env (dev: polling)
      **Verification:** запустить бота, написать `/start` в Telegram, кнопка открывает TMA.
      **Dependencies:** Task 1
      **Files likely touched:** `apps/backend/src/bot/**`
      **Estimated scope:** Small

#### Task 7: LlmProviders catalog

**Description:** Каталог поддерживаемых LLM-провайдеров (Groq, Gemini, OpenRouter, custom) с `base_url`, `key_env`, дефолтной моделью, шаблоном `config.yaml`. `GET /llm-providers` отдаёт его фронту.
**Acceptance criteria:**

- [x] `GET /llm-providers` возвращает массив провайдеров с полями `{ id, name, base_url, key_env, default_model, docs_url }`
- [x] Каталог — кодом/конфигом, не в БД (статичный справочник)
- [x] Юнит-тесты
      **Verification:** `npm test -- llm-providers`; curl эндпойнта.
      **Dependencies:** Task 1
      **Files likely touched:** `apps/backend/src/llm-providers/**`, `packages/shared/src/llm.ts`
      **Estimated scope:** Small

#### Task 8: Bot-token validation endpoint

**Description:** `POST /validate-bot-token` проксирует в Telegram `getMe`, возвращает username бота. Валидирует токен до создания деплоя.
**Acceptance criteria:**

- [x] Валидный токен → 200 `{ username, id }`
- [x] Невалидный токен → 422
- [x] Токен уже используется другим активным деплоем → 409
- [x] Тесты с моком Telegram API
      **Verification:** `npm test -- validate-bot-token`.
      **Dependencies:** Task 2, Task 5 (auth-контекст)
      **Files likely touched:** `apps/backend/src/deploys/validate-bot-token/**`, `apps/backend/test/validate-bot-token.spec.ts`
      **Estimated scope:** Small

### Checkpoint: Identity & input validation

- [x] Бот открывает Mini App, TMA-авторизация работает
- [x] Форма видит каталог провайдеров
- [x] Можно валидировать bot token
- [ ] Ревью перед Phase 3

### Phase 3: Deploy happy path (core)

#### Task 9: POST /deploys endpoint

**Description:** Создание деплоя: валидация ввода, шифрование bot token + LLM-ключа, создание `Deploy(pending)` + one-time bootstrap-токен (hash в БД), постановка job в BullMQ.
**Acceptance criteria:**

- [x] `POST /deploys` → 202 `{ deploy_id }` (требует auth)
- [x] Секреты шифруются перед записью; в БД только `_enc`
- [x] Bootstrap-токен генерируется, в БД хранится только hash
- [x] Job `deploy` ставится в очередь
- [x] Тесты (мок очереди)
      **Verification:** `npm test -- deploys.create`.
      **Dependencies:** Task 2, Task 3, Task 5, Task 8
      **Files likely touched:** `apps/backend/src/deploys/**`, `packages/shared/src/deploy.ts`
      **Estimated scope:** Medium

#### Task 10: Post-install script generator

**Description:** Сервис генерирует bash-скрипт для `/post_install`: установить Hermes → `GET /bootstrap/:id?token=...` (тянет секреты) → пишет `.env` + `config.yaml` + `docker-compose.yml` → `docker compose up -d` (template 1121, Docker предустановлен) → `POST /webhooks/deploy-ready`. **Без секретов в скрипте.**
**Acceptance criteria:**

- [x] Сгенерированный скрипт ≤ 48KB
- [x] В скрипте нет bot token / LLM-ключа (только bootstrap URL с одноразовым токеном)
- [x] Скрипт пишет логи в `/post_install.log`, корректно экранирует значения
- [x] Юнит-тесты на содержимое скрипта (assert: нет секретов, есть нужные команды)
      **Verification:** `npm test -- script-generator`; ревью сгенерированного скрипта глазами.
      **Dependencies:** Task 7 (шаблон config.yaml), Task 9 (deploy_id, bootstrap URL)
      **Files likely touched:** `apps/backend/src/provisioning/script-generator.ts`, `apps/backend/test/script-generator.spec.ts`
      **Estimated scope:** Small

#### Task 11: Bootstrap module (secret pull)

**Description:** `GET /bootstrap/:deploy_id?token=...` — отдаёт расшифрованные секреты VPS. Проверяет: токен валиден (hash), не использован, IP звонящего = IP VM (берём из Hostinger getVM), после выдачи — инвалидировать токен.
**Acceptance criteria:**

- [x] Валидный токен + совпадающий IP → 200 `{ env, config_yaml, compose, webhook_secret }` (рендерим файлы на бэкенде, а не сырые секреты — см. arch §16)
- [x] Невалидный/重复 token → 404; IP-несовпадение → 403
- [x] Токен горит после первого успешного использования (replay-защита; атомарный `updateMany` с guard'ом на `bootstrap_used_at=null`)
- [x] Тесты на все ветки
      **Verification:** `npm test -- bootstrap`.
      **Dependencies:** Task 2, Task 3, Task 4 (getVM для IP), Task 9
      **Files likely touched:** `apps/backend/src/bootstrap/**`, `apps/backend/test/bootstrap.spec.ts`
      **Estimated scope:** Medium

#### Task 12: Provisioning worker (deploy job)

**Description:** BullMQ-воркер `deploy`: создать post-install script (Hostinger) → `purchaseVM(setup{template_id, data_center_id, post_install_script_id})` → поллить `listActions` до installed → записать `hostinger_vm_id`/`hostinger_script_id`. На любом шаге fail → cleanup + `status=failed`.
**Acceptance criteria:**

- [x] Воркер проходит стейт-машину `pending → creating → configuring` (→ `ready` через webhook Task 13, `failed` при ошибке)
- [x] Каждый шаг пишется в `ProvisioningLog`
- [x] При ошибке — `deletePostInstallScript` + `deleteVM` (если создан) + уведомление
- [x] Идемпотентность по `deploy_id` (атомарный claim `pending → creating`)
- [x] Тесты с замоканным Hostinger SDK
      **Verification:** `npm test -- worker.deploy`.
      **Dependencies:** Task 4, Task 9, Task 10
      **Files likely touched:** `apps/backend/src/workers/deploy.worker.ts`, `apps/backend/src/workers/**`, `apps/backend/test/deploy.worker.spec.ts`
      **Estimated scope:** Medium

#### Task 13: Webhook /deploy-ready + bot notification

**Description:** `POST /webhooks/deploy-ready` от VPS → `status=ready`, инвалидировать bootstrap (на всякий), бот шлёт клиенту «готово, напиши @botusername». Подпись webhook'а (одноразовый секрет из bootstrap-пэйлоада).
**Acceptance criteria:**

- [x] Валидный webhook → `status=ready`, сообщение клиенту
- [x] Невалидная подпись/несуществующий deploy → 404
- [x] Повторный webhook для уже ready → идемпотентно 200
- [x] Тесты
      **Verification:** `npm test -- webhooks`.
      **Dependencies:** Task 6 (bot), Task 9, Task 12
      **Files likely touched:** `apps/backend/src/webhooks/**`, `apps/backend/test/webhooks.spec.ts`
      **Estimated scope:** Small

### Checkpoint: Deploy happy path

- [x] Бэкенд-flow на моках: POST /deploys → воркер (SDK замокан) → bootstrap → webhook → ready (146 тестов, 27 suites; DI-граф и роуты проверены smoke-бутом). TMA-форма — Phase 4.
- [x] Один реальный деплой на боевом Hostinger-токене — **чекпойнт пройден 2026-07-05**. Живой клиент из Telegram развернул агента: VPS KVM 1 (Vilnius, 1806763) куплен → Hermes через Docker Manager → бот отвечает. По пути найдены и закрыты боем: 402-гонка оплаты (self-heal подхвата оплаченной VM), CPU-лимит 2.0→1.0 (не давал контейнеру стартовать на 1 vCPU), teardown-guard (не удалять VM, занятую активным деплоем). Детали — architecture §21. Fail-path (деклайн карты) тоже проверен: `failed` без orphan-VM
- [ ] Ревью перед Phase 4

### Phase 4: Mini App UI

#### Task 14: Deploy form

**Description:** React TMA-экран: выбор провайдера (из `GET /llm-providers`), инпут bot token + LLM-ключ, кнопка «Деплой». Валидация bot token через `POST /validate-bot-token` перед сабмитом.
**Acceptance criteria:**

- [x] Форма собирает `{ bot_token, llm_provider, llm_key }` (+ base_url/model для custom)
- [x] Перед сабмитом — валидация bot token, показ username
- [x] `POST /deploys` → переход на статус-экран с `deploy_id`
- [x] Сборка TMA работает, бандл разумного размера (~200KB / 63KB gzip)
      **Verification:** `npm run build` (frontend); ручной прогон в Telegram-клиенте.
      **Dependencies:** Task 5 (auth), Task 7, Task 8, Task 9
      **Files likely touched:** `apps/frontend/src/**`, `packages/shared/src/api.ts`
      **Estimated scope:** Medium

#### Task 15: Deploy status view

**Description:** Экран статуса: поллит `GET /deploys/:id`, показывает прогресс (`pending/creating/configuring/ready/failed`), при ready — ссылка на бота + инструкция.
**Acceptance criteria:**

- [x] Поллинг каждые 3с, корректные состояния (стоп на terminal)
- [x] `ready` → кнопка на `https://t.me/<bot_username>` (через `openTelegramLink`)
- [x] `failed` → сообщение об ошибке + «начать заново»
- [x] Нет утечки секретов в UI (форма не хранит/не показывает токен после ввода; статус тянет `DeployView` без секретов)
      **Verification:** ручной прогон; проверка DOM на отсутствие секретов.
      **Dependencies:** Task 14
      **Files likely touched:** `apps/frontend/src/**`
      **Estimated scope:** Small

### Checkpoint: Mini App UI

- [x] UI собран и покрыт vitest-тестами (api-клиент, telegram-мост, статус-хелперы; 15 тестов). Форма → валидация → POST /deploys → статус-экран с поллингом.
- [ ] Ручной прогон в Telegram-клиенте против живого бэкенда — прод доступен (`https://hermes.mxpkn8ns.ru/app/`, задеплоен в Dokploy 2026-07-05, туннель не нужен); осталось задать Web App URL в BotFather и пройти флоу
- [ ] Ревью перед Phase 5

### Phase 5: Teardown & resilience

#### Task 16: Teardown flow

**Description:** `DELETE /deploys/:id` → BullMQ job `teardown`: `deleteVM` + `deletePostInstallScript`, `status=deleted`, уведомление клиента.
**Acceptance criteria:**

- [x] Удаление инициирует teardown-job, возвращает 202
- [x] Воркер удаляет VM и script (если существуют), статус `deleted`
- [x] Идемпотентность (повторный DELETE — ок; уже `deleted` → не ставит job)
- [x] Тесты (мок Hostinger)
      **Verification:** `npm test -- teardown`.
      **Dependencies:** Task 12
      **Files likely touched:** `apps/backend/src/deploys/teardown/**`, `apps/backend/src/workers/teardown.worker.ts`
      **Estimated scope:** Small

#### Task 17: Reconciliation cron

**Description:** Daily-джоба: сверка `Deploy` в БД vs реальных VM в Hostinger (`getVirtualMachines`). Orphan-VM (есть в Hostinger, нет в БД или статус deleted) → алерт + опционально удалить.
**Acceptance criteria:**

- [x] Cron запускается раз в сутки (`@nestjs/schedule`, 03:00)
- [x] Детектит orphan-VM (+ deploys с пропавшей VM), пишет лог/алерт; опц. удаление за флагом
- [x] Тесты с моком списка VM
      **Verification:** `npm test -- reconcile`.
      **Dependencies:** Task 4, Task 12
      **Files likely touched:** `apps/backend/src/workers/reconcile.worker.ts`
      **Estimated scope:** Small

#### Task 18: Failure handling hardening

**Description:** Проверить все пути ошибок: Hostinger API 5xx/429, таймаут поллинга, /post_install не отчитался за N минут → cleanup + `failed`. Ретраи с backoff.
**Acceptance criteria:**

- [x] Таймаут `configuring`/`creating` → `failed` + cleanup (watchdog >20 мин каждые 5 мин + poll-таймаут воркера 10 мин)
- [x] Ретраи на 429/5xx/сеть с exponential backoff (`common/retry.ts`), не больше K попыток; 4xx — фатально
- [x] Ни один путь не оставляет orphan-VPS (cleanup при fail + watchdog + reconcile)
- [x] Тесты на таймаут и ретраи
      **Verification:** `npm test -- resilience`.
      **Dependencies:** Task 12, Task 13, Task 16
      **Files likely touched:** `apps/backend/src/workers/**`, `apps/backend/src/provisioning/**`
      **Estimated scope:** Medium

### Checkpoint: Teardown & resilience

- [x] Тирдаун работает, orphan-детекция (reconcile) + watchdog (stuck-deploy) работают, failure-пути покрыты тестами (retry, timeout, cleanup)
- [x] MVP код-комплит на моках (198 тестов: 183 backend + 15 frontend, build/lint/typecheck зелёные, DI/роуты/cron проверены smoke-бутом)
- [x] Закрытый тест на реальном деплое (`DRY_RUN=false`) — пройден 2026-07-05 (см. Checkpoint: Deploy happy path и architecture §21). Плюс личный кабинет «Мои агенты» (restart / смена LLM-ключа / удаление).

### Phase 6: One-click bundle + Tribute billing (специфицировано 2026-07-08 — см. architecture §23)

> Вертикальные срезы. Каждый task = работающий тестируемый путь. Источник правды по фактам — §23 (sourced).

#### Task 19: Subscription module — Tribute channel-membership gating

**Description:** `SubscriptionModule` — проверка подписки через `getChatMember` приватного канала «Hermes» (entry-бот админ). Env: `SUBSCRIPTION_CHANNEL_ID` (BigInt). `chat_member` update-handler в `BotService` → обновление `subscription_status`. Endpoints `GET /subscription/status`, `POST /subscription/check` (auth).
**Acceptance criteria:**

- [x] `POST /subscription/check` форсит `getChatMember(channel, user_id)` → `subscription_status` (`active`/`expired`/`none`) в БД
- [x] `chat_member` update (вступил/вышел) → `subscription_status` обновляется без ручного триггера
- [ ] entry-бот админ канала «Hermes» (инструкция в `docs/deploy`); `@tribute` админ того же канала — **pending: оператор должен создать канал и настроить @tribute**
- [x] Юнит-тесты (мок `bot.api.getChatMember`)
      **Verification:** `npm test -w apps/backend -- subscription` — 9 тестов зелёные.
      **Dependencies:** Task 6 (bot)
      **Files touched:** `apps/backend/src/subscription/**`, `apps/backend/src/bot/**`, `packages/shared/src/subscription.ts`
      **Estimated scope:** Medium

#### Task 20: OpenRouterKeys module — Management API

**Description:** `OpenRouterKeysModule` — обёртка над `POST/PATCH/DELETE /api/v1/keys` (Context7 `/websites/openrouter_ai`). Env: `OPENROUTER_MANAGEMENT_KEY`. `createKey(deployId, limit=40, reset="monthly")` → plaintext шифруется в `llm_key_enc`, `hash` в `openrouter_key_hash`. `raiseLimit(hash, addUsd)` (доплата), `disableKey(hash)` (отток).
**Acceptance criteria:**

- [x] `createKey` → `POST /api/v1/keys` → шифр в `llm_key_enc` (AES-256-GCM), `hash` в БД; plaintext не логируется
- [x] `raiseLimit` → `PATCH /api/v1/keys/{hash}` с новым `limit` (старый + N)
- [x] `disableKey` → `PATCH` с `disabled: true` (и `false` для re-enable)
- [x] `deleteKey` → `DELETE` (при teardown)
- [x] Моки OpenRouter API; ключи/management-key не в логах
- [x] Юнит-тесты
      **Verification:** `npm test -w apps/backend -- openrouter-keys` — 13 тестов зелёные.
      **Dependencies:** Task 3 (secrets)
      **Files touched:** `apps/backend/src/openrouter-keys/**`, `packages/shared/src/openrouter.ts`
      **Estimated scope:** Medium

#### Task 21: DB migration — Phase 6 колонки + drop paid_until

**Description:** Миграция: `Deploy` += `openrouter_key_hash`, `subscription_channel_id`, `subscription_status`, `subscription_until`, `subscription_expired_at`, `bot_token_status`; DROP `paid_until` (vestigial); `llm_key_enc` → nullable (worker mintит managed key).
**Acceptance criteria:**

- [x] `prisma migrate dev` накатывает без ошибок (3 миграции: `phase6_subscription_openrouter_keys`, `phase6_nullable_llm_key`, `phase6_subscription_expired_at`)
- [x] `prisma generate` обновляет типы
- [x] `paid_until` удалён; новые поля nullable (обратная совм. с существующими деплоями)
      **Verification:** `npm run prisma:migrate` (из `apps/backend`) — 3 миграции applied.
      **Dependencies:** Task 19, Task 20
      **Files touched:** `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/**`
      **Estimated scope:** Small

#### Task 22: One-click deploy flow — убрать BYOK из главного UI

**Description:** `POST /deploys` принимает только `{ bot_token, agent? }` (provider=openrouter, LLM-ключ от оператора). Воркер: после `acquireVm`/`running` → `openRouterKeys.createKey()` → расшифровать → `createDockerProject` с `OPENROUTER_API_KEY`. Frontend: `ProviderStep.tsx` выпиливается из главного флоу; экран = bot-token + **оплата** (кнопка в @tribute). `GET /llm-providers` отдаёт только `openrouter` (+ `custom` по `?advanced=1`).
**Acceptance criteria:**

- [x] `POST /deploys` без `llm_key`/`llm_provider` в body (бэкенд ставит openrouter + создаёт ключ); subscription gate (402 если не active)
- [x] `ProviderStep.tsx` не показывается в главном flow (заменён на `PaymentStep.tsx`; BYOK — скрытый advanced)
- [x] Экран создания: bot-token → оплата (deep-link @tribute) → статус
- [x] Воркер интегрирован с `OpenRouterKeysModule` (mintит ключ после VM up, persistит hash + шифр)
- [x] Тесты (воркер + controller + subscription gate)
      **Verification:** `npm test -w apps/backend -- deploys` — 30+ тестов зелёные.
      **Dependencies:** Task 19, Task 20, Task 21
      **Files touched:** `apps/backend/src/deploys/**`, `apps/backend/src/workers/deploy.processor.ts`, `apps/backend/src/llm-providers/**`, `apps/frontend/src/components/**` (`PaymentStep.tsx`, `App.tsx`), `packages/shared/src/llm.ts`, `packages/shared/src/deploy.ts`
      **Estimated scope:** Large

#### Task 23: Topup — доплата за токены

**Description:** `POST /deploys/topup` (auth, owner) → Tribute-оплата через фиксированные tier-каналы (+25% markup) → `openRouterKeys.raiseLimit(hash, addUsd)`. Frontend: в кабинете кнопка «Пополнить токены» с выбором тира.
**Acceptance criteria:**

- [x] `POST /deploys/topup` → проверка membership тир-канала → `raiseLimit` на существующем ключе (без re-push env — ключ тот же)
- [x] Наценка +25% зафиксирована (env `OPENROUTER_TOPUP_MARKUP_PERCENT`)
- [x] Кабинет: кнопка пополнения + выбор тира (`GET /deploys/topup/tiers`)
- [x] Тесты (service + controller)
      **Verification:** `npm test -w apps/backend -- topup` — 17 тестов зелёные.
      **Dependencies:** Task 20, Task 22
      **Files touched:** `apps/backend/src/deploys/topup/**`, `apps/frontend/src/components/AgentDetailScreen.tsx`, `apps/frontend/src/api.ts`, `packages/shared/src/topup.ts`
      **Estimated scope:** Medium
      **Note:** Tribute не имеет API для разовых платежей — верификация через membership фиксированных tier-каналов (решение оператора, 2026-07-11).

#### Task 24: Bot-token recovery + healthcheck

**Description:** `PATCH /deploys/:id/bot-token` (auth, owner) — образец `updateLlmKey`: `validateBotToken` → перешифровать `bot_token_enc` → re-render env → `updateDockerProject` (VPS не трогается). @Cron healthcheck: `getMe` по токенам активных деплоев → 401 → `bot_token_status=invalid` → красный бейдж в кабинете + кнопка «сменить токен». Кнопка `/botfather` → `openTelegramLink`.
**Acceptance criteria:**

- [x] `PATCH /deploys/:id/bot-token` меняет токен без пересоздания VPS (re-push через `updateDockerProject`); исключает self из uniqueness check
- [x] @Cron healthcheck (hourly) помечает `bot_token_status`; кабинет показывает бейдж + CTA
- [x] Кнопка @BotFather в Mini App открывает @BotFather
- [x] Тесты (recovery + healthcheck с мок getMe + isTokenValid)
      **Verification:** `npm test -w apps/backend -- token-healthcheck validate-bot-token deploys` — 25+ тестов зелёные.
      **Dependencies:** Task 22
      **Files touched:** `apps/backend/src/deploys/bot-token.dto.ts`, `apps/backend/src/deploys/deploys.service.ts`, `apps/backend/src/deploys/validate-bot-token.service.ts`, `apps/backend/src/workers/token-healthcheck.{service,scheduler}.ts`, `apps/frontend/src/components/AgentDetailScreen.tsx`, `packages/shared/src/deploy.ts`
      **Estimated scope:** Medium

#### Task 25: Subscription expiry → key disable

**Description:** `chat_member` update (вышел из канала — Tribute убрал за неоплату) → `subscription_status=expired` → `openRouterKeys.disableKey(hash)`. Агент заморожен (VPS не трогать до продления/teardown). Daily cron авт-teardown после grace-периода (`SUBSCRIPTION_GRACE_DAYS=7`).
**Acceptance criteria:**

- [x] Выход из канала → `disableKey` (Hermes получит 401/403 от OpenRouter); `subscription_expired_at` stamped
- [x] `subscription_status=expired` в кабинете; продление (возврат в канал) → `enableKey` (PATCH disabled:false); `subscription_expired_at` cleared
- [x] Grace-период перед teardown (env `SUBSCRIPTION_GRACE_DAYS`, daily cron `SubscriptionExpiryService`)
- [x] Тесты (bot chat_member handler + expiry service)
      **Verification:** `npm test -w apps/backend -- subscription-expiry bot` — 15+ тестов зелёные.
      **Dependencies:** Task 19, Task 20
      **Files touched:** `apps/backend/src/bot/bot.service.ts`, `apps/backend/src/subscription/subscription.service.ts`, `apps/backend/src/workers/subscription-expiry.{service,scheduler}.ts`, `apps/backend/src/workers/teardown.processor.ts`
      **Estimated scope:** Small

### Checkpoint: Phase 6 — one-click bundle live

- [x] Все 7 задач зелёные (lint/build/typecheck/test) — 308 тестов (275 backend + 33 frontend)
- [x] Код деплоен в прод (`https://hermes.mxpkn8ns.ru`) — приложение стартует, роуты зарегистрированы, `/llm-providers` отдаёт только `openrouter`
- [ ] Ручной прогон: оплата в @tribute → membership → деплой с managed-ключом → агент отвечает → доплата → cap поднят → отток → ключ disabled — **pending: оператор настраивает `SUBSCRIPTION_CHANNEL_ID` + `OPENROUTER_MANAGEMENT_KEY` в Dokploy env**
- [ ] Bot-token recovery: симуляция удаления бота → смена токена → агент работает — **pending: нужен живой деплой для теста**
- [ ] Ревью с человеком перед продом (`DRY_RUN=false` + реальная Tribute-подписка) — **pending**

## Risks and Mitigations

| Risk                                                                           | Impact | Mitigation                                                                           |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------ |
| Hostinger post-install script ведёт себя иначе в реальности (не root, тайминг) | High   | Реальный тест-деплой в Checkpoint 3; fallback — SSH-выполнение того же скрипта       |
| `purchaseVM` списывает реальные деньги                                         | Med    | Использовать минимальный тариф в деве; флаг `DRY_RUN` для моков                      |
| IP звонящего в /bootstrap отличается от IP VM (NAT/IPv6)                       | High   | Проверить на реальном деплое; fallback — подписанный one-time JWT вместо IP-проверки |
| `hermes setup` не полностью неинтерактивный                                    | Med    | Проверить доки; использовать env-переменные / docker compose (без визарда)           |
| Один bot token на два деплоя                                                   | Low    | Валидация уникальности в Task 8                                                      |
| Orphan-VPS при падении бэкенда mid-deploy                                      | High   | Reconciliation cron (Task 17) + идемпотентные воркеры                                |

## Resolved Decisions

- **Запуск Hermes**: `docker compose up -d` (официальный образ `nousresearch/hermes-agent:latest`). Изоляция, чистый teardown/upgrade.
- **Template**: `1121` (Ubuntu 24.04 with Docker) — Docker предустановлен. Готового Hermes-template в API нет.
- **VPS-тариф**: KVM 1 (`hostingercom-vps-kvm1`, 1 vCPU / 4GB / 50GB). `item_id`: `hostingercom-vps-kvm1-usd-1m` (monthly, для подписки); `...-usd-1y` (yearly, дешевле, но предоплата).
- **Data-center**: Vilnius (id=11) — ближайший к РФ; fallback Frankfurt (id=19).
- **LLM-ключ**: обязательное поле перед деплоем. Решение «без тестового вызова» пересмотрено 2026-07-05: ключ проверяется `POST /validate-llm-key` — chat-ping + tool-call probe + stream probe (Hermes требует tools и streaming, см. architecture §20); сабмит в Mini App активируется только после успешной проверки.
- **Платёжка (Phase 6)**: **Tribute** (`@tribute`, рубли/Mir, комиссия 10%, выплаты 2×/мес на карту). Отклонён Telegram Stars — вывод только в TON через Fragment + двойная комиссия (сторы на входе + Telegram на выводе), существенно дороже 10% Tribute; для цели «рубли на карту, РФ» Stars непригоден. Интеграция — channel-membership gating (нет API у Tribute): `getChatMember` канала «Hermes» = источник правды подписки. См. architecture §23.2.
- **Hostinger-токен**: есть (личный аккаунт). Хранить только в `.env` (gitignored). Ротировать перед продом. Personal-аккаунт работает для API (`purchaseVM` списывает с карты оператора); реселлерские ToS/налоги — уточнить у Hostinger (не блокирует dev).
- **Прод control-plane (2026-07-05)**: Dokploy на VPS оператора — Traefik + Let's Encrypt, домен `hermes.mxpkn8ns.ru`, один Docker-образ из корневого `Dockerfile` (миграции на старте контейнера), single-origin (Mini App под `/app/`), Postgres 16 + Redis 7 как сервисы Dokploy, автодеплой из `main`. Ранбук: `docs/deploy/dokploy.md`. Туннель (ngrok/cloudflared) больше не нужен.

## Economics (Phase 6 — one-click bundle, пересмотрено 2026-07-08)

Себестоимость/мес (VPS monthly): KVM 1 **$19.49** + OpenRouter limit **$40** = **$59.49**. Прайс = (себестоимость + маржа) ÷ 0.9 (Tribute 10%).

| Маржа | Чистыми/мес | Прайс юзера                                        |
| ----- | ----------- | -------------------------------------------------- |
| +30%  | $18.05      | $85.93 → фикс. **7900 ₽** (~$86) — зафиксировано   |
| +50%  | $30.03      | $99.15 (~8900 ₽) — резерв, если 30% окажется тесно |

Доплата при исчерпании cap: **+25% наценка** ($10 токенов → $12.50 от юзера, $1.25 чистыми; $50 → $62.50, $6.25 чистыми). Наценка >10% обязательна — иначе Tribute съедает маржу в ноль. Cap ($40) встроен в OpenRouter-ключ (`limit`, `limit_reset: monthly`), инфра оператора не трогает LLM-трафик.

Оборотный капитал: OpenRouter не принимает Mir → оператор пополняет депозит foreign card/криптой, рубли от Tribute приходят 2×/мес (10/25 числа). Буфер ≈ $40 × N одновременных клиентов на 1–2 мес вперёд.

Yearly VPS ($12.99/мес эфф.) — опц. для снижения прайса до ~7400 ₽ при той же марже, требует предоплату VPS на год (капитал). Отложено — стартуем на monthly.

## Open Questions (остались)

- [ ] **Tribute API?** Программного API выдачи подписок в wiki не задокументировано (интеграция идёт через `getChatMember`, не через Tribute-API). Непроверенное: стучаться `@TributeCreatorBot` / `partnerships@top.team` — возможно есть partner-API для оффлайн-выдачи. Не блокирует Phase 6 (channel-gating работает без него).
- [ ] Реселлерские ToS Hostinger — подтвердить у саппорта (не блокирует dev).
- [ ] **Managed Bots (Bot API 9.6)** — отложено после Phase 6: `getManagedBotToken`/`replaceManagedBotToken` убирают шаг @BotFather целиком (entry-бот как manager). Требует _Bot Management Mode_ в BotFather MiniApp + handler `managed_bot` update. Отдельная фаза.
