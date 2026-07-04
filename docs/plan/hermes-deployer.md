# Implementation Plan: Hermes Deployer

## Overview
One-click деплой Hermes-агента для нетехнического клиента через Telegram Mini App. Клиент вводит bot token + LLM-провайдер + LLM-ключ → бэкенд через Hostinger API поднимает VPS с post-install script → Hermes настраивается без SSH и стартует → клиент получает работающего бота. Стек: Node/TS (NestJS + grammY + Prisma + hostinger-api-sdk) + React/Vite TMA.

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
- [ ] Один реальный деплой на боевом Hostinger-токене (зафиксировать артефакты: созданный script, VM, лог `/post_install.log`) — требует `DRY_RUN=false` + чекпойнт с человеком
- [ ] Ревью перед Phase 4

### Phase 4: Mini App UI

#### Task 14: Deploy form
**Description:** React TMA-экран: выбор провайдера (из `GET /llm-providers`), инпут bot token + LLM-ключ, кнопка «Деплой». Валидация bot token через `POST /validate-bot-token` перед сабмитом.
**Acceptance criteria:**
- [ ] Форма собирает `{ bot_token, llm_provider, llm_key }`
- [ ] Перед сабмитом — валидация bot token, показ username
- [ ] `POST /deploys` → переход на статус-экран с `deploy_id`
- [ ] Сборка TMA работает, бандл разумного размера
**Verification:** `npm run build` (frontend); ручной прогон в Telegram-клиенте.
**Dependencies:** Task 5 (auth), Task 7, Task 8, Task 9
**Files likely touched:** `apps/frontend/src/**`, `packages/shared/src/api.ts`
**Estimated scope:** Medium

#### Task 15: Deploy status view
**Description:** Экран статуса: поллит `GET /deploys/:id`, показывает прогресс (`pending/creating/configuring/ready/failed`), при ready — ссылка на бота + инструкция.
**Acceptance criteria:**
- [ ] Поллинг каждые N секунд, корректные состояния
- [ ] `ready` → кнопка/ссылка на `https://t.me/<bot_username>`
- [ ] `failed` → сообщение об ошибке + контакт поддержки
- [ ] Нет утечки секретов в UI (никогда не показываем bot token/ключ после ввода)
**Verification:** ручной прогон; проверка DOM на отсутствие секретов.
**Dependencies:** Task 14
**Files likely touched:** `apps/frontend/src/**`
**Estimated scope:** Small

### Checkpoint: Mini App UI
- [ ] Полный UI-flow работает против бэкенда (мок или реальный деплой)
- [ ] Ревью перед Phase 5

### Phase 5: Teardown & resilience

#### Task 16: Teardown flow
**Description:** `DELETE /deploys/:id` → BullMQ job `teardown`: `deleteVM` + `deletePostInstallScript`, `status=deleted`, уведомление клиента.
**Acceptance criteria:**
- [ ] Удаление инициирует teardown-job, возвращает 202
- [ ] Воркер удаляет VM и script (если существуют), статус `deleted`
- [ ] Идемпотентность (повторный DELETE — ок)
- [ ] Тесты (мок Hostinger)
**Verification:** `npm test -- teardown`.
**Dependencies:** Task 12
**Files likely touched:** `apps/backend/src/deploys/teardown/**`, `apps/backend/src/workers/teardown.worker.ts`
**Estimated scope:** Small

#### Task 17: Reconciliation cron
**Description:** Daily-джоба: сверка `Deploy` в БД vs реальных VM в Hostinger (`getVirtualMachines`). Orphan-VM (есть в Hostinger, нет в БД или статус deleted) → алерт + опционально удалить.
**Acceptance criteria:**
- [ ] Cron запускается раз в сутки
- [ ] Детектит orphan-VM, пишет лог/алерт
- [ ] Тесты с моком списка VM
**Verification:** `npm test -- reconcile`.
**Dependencies:** Task 4, Task 12
**Files likely touched:** `apps/backend/src/workers/reconcile.worker.ts`
**Estimated scope:** Small

#### Task 18: Failure handling hardening
**Description:** Проверить все пути ошибок: Hostinger API 5xx/429, таймаут поллинга, /post_install не отчитался за N минут → cleanup + `failed`. Ретраи с backoff.
**Acceptance criteria:**
- [ ] Таймаут `configuring` (> 10 мин) → `failed` + cleanup
- [ ] Ретраи на 429/5xx с backoff, не больше K попыток
- [ ] Ни один путь не оставляет orphan-VPS
- [ ] Тесты на таймаут и ретраи
**Verification:** `npm test -- resilience`.
**Dependencies:** Task 12, Task 13, Task 16
**Files likely touched:** `apps/backend/src/workers/**`, `apps/backend/src/provisioning/**`
**Estimated scope:** Medium

### Checkpoint: Teardown & resilience
- [ ] Тирдаун работает, orphan-детекция работает, все failure-пути покрыты
- [ ] MVP готов к закрытому тесту

### Phase 6: Billing (deferred — open questions)
- Task 19: Subscription model + payment provider (зависит от выбора платёжки для RU).
- Task 20: Quota-gating: деплой только при активной подписке.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Hostinger post-install script ведёт себя иначе в реальности (не root, тайминг) | High | Реальный тест-деплой в Checkpoint 3; fallback — SSH-выполнение того же скрипта |
| `purchaseVM` списывает реальные деньги | Med | Использовать минимальный тариф в деве; флаг `DRY_RUN` для моков |
| IP звонящего в /bootstrap отличается от IP VM (NAT/IPv6) | High | Проверить на реальном деплое; fallback — подписанный one-time JWT вместо IP-проверки |
| `hermes setup` не полностью неинтерактивный | Med | Проверить доки; использовать env-переменные / docker compose (без визарда) |
| Один bot token на два деплоя | Low | Валидация уникальности в Task 8 |
| Orphan-VPS при падении бэкенда mid-deploy | High | Reconciliation cron (Task 17) + идемпотентные воркеры |

## Resolved Decisions
- **Запуск Hermes**: `docker compose up -d` (официальный образ `nousresearch/hermes-agent:latest`). Изоляция, чистый teardown/upgrade.
- **Template**: `1121` (Ubuntu 24.04 with Docker) — Docker предустановлен. Готового Hermes-template в API нет.
- **VPS-тариф**: KVM 1 (`hostingercom-vps-kvm1`, 1 vCPU / 4GB / 50GB). `item_id`: `hostingercom-vps-kvm1-usd-1m` (monthly, для подписки); `...-usd-1y` (yearly, дешевле, но предоплата).
- **Data-center**: Vilnius (id=11) — ближайший к РФ; fallback Frankfurt (id=19).
- **LLM-ключ**: обязательное поле перед деплоем, без тестового вызова.
- **Платёжка (Phase 6)**: Telegram Stars.
- **Hostinger-токен**: есть (личный аккаунт). Хранить только в `.env` (gitignored). Ротировать перед продом. Personal-аккаунт работает для API (`purchaseVM` списывает с карты оператора); реселлерские ToS/налоги — уточнить у Hostinger (не блокирует dev).

## Economics (пересмотрено — строить от renewal, не от промо)
Реальная себестоимость KVM 1 (renewal): **$19.49/мес** (monthly) или **$12.99/мес** (yearly prepay). При марже 30%: sell ≈ $25/мес (monthly) → ~$5/мес маржа/клиент; либо yearly $13/мес → sell ≈ $17/мес → ~$4/мес (нужен капитал, риск churn). First-month промо $9.99 — лидер убытка, в прайс не закладывать.

## Open Questions (остались)
- [ ] Точная комиссия Telegram Stars (cut Telegram) — влияет на финальный прайс (Phase 6).
- [ ] Реселлерские ToS Hostinger — подтвердить у саппорта (не блокирует dev).
