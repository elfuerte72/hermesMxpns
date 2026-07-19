# AGENTS.md — Hermes Deployer

One-click деплой Hermes-агента (Nous Research) для нетехнического клиента через Telegram Mini App: клиент платит подписку (Tribute, рубли) → бэкенд создаёт managed OpenRouter-ключ (spend-cap) и поднимает Hostinger VPS → Hermes стартует через Docker Manager API → бот отвечает в Telegram без SSH и без похода за API-ключом. Коммерческое, маржа ~30% поверх VPS+LLM.

## Read first (in order)

1. this file
2. `docs/intent/hermes-deployer.md` — подтверждённое намерение (what/why/success/constraints)
3. `docs/architecture/hermes-deployer.md` — технический референс: Hostinger API, Hermes setup, LLM-провайдеры, модель данных, flow, безопасность. **Факты sourced — не переследовать, не угадывать; при пробеле спросить человека, не изобретать.**
4. `docs/plan/hermes-deployer.md` — фазы/задачи и открытые чекпойнты (реализовывать строго по фазам, вертикальными срезами)
5. `docs/deploy/dokploy.md` — прод на Dokploy

Свежий агент: прочитать доки по порядку → сверить статус ниже и открытые чекпойнты в `docs/plan` → факты брать из `docs/architecture`; если устарели — обновлять док, а не молча отклоняться. `CLAUDE.md` содержит supplementary детали (provisioning flow, bot webhook) — перекрывается с `docs/architecture`.

## Stack & layout

npm workspaces monorepo, три пакета (оба приложения импортируют `@hermes/shared`):

- `packages/shared` — общие типы + чистые функции (`hostinger.ts`, `llm.ts`, `auth.ts`, `api.ts`, `deploy.ts`, `subscription.ts`, `openrouter.ts`, `topup.ts`). **Резолвится в свой `dist`** (`main`/`types` → `dist`), не в исходники.
- `apps/backend` — NestJS 11 + Prisma 7 (driver adapter `@prisma/adapter-pg`) + BullMQ + grammY + `hostinger-api-sdk`. Entry `src/main.ts`. Модули: Auth, Bot, Secrets, Provisioning, LlmProviders, Deploys (+ подмодуль `deploys/topup`, validate-llm-key/bot-token), Subscription, OpenRouterKeys, Notifications (deploy-уведомления в бота), Workers (deploy/teardown/reconcile/stuck-deploy/token-healthcheck/subscription-expiry).
- `apps/frontend` — React 19 + Vite 8 + Tailwind 4. **Мост к Telegram — свой `src/telegram.ts` над `window.Telegram.WebApp`; `@telegram-apps/sdk-react` в `package.json` — vestigial, нигде не импортируется, не использовать.** Экраны: Menu, About, BotTokenStep, ProviderStep (custom под `?advanced=1`), PaymentStep (Tribute), DeployStatusView, AgentsList, AgentDetail (live-статус VM/контейнера / restart / смена LLM-ключа / смена bot-token / topup / удаление).

Infra: Postgres 16 + Redis 7 (`docker compose up -d`). Node ≥ 20.11. CI нет — прод-деплой через Dokploy autodeploy из `main`.

## Commands (из корня, если не сказано иное)

- `npm run build` — shared → backend → frontend (порядок важен, см. ниже)
- `npm run dev` — собирает shared, затем concurrently shared-watch + backend (nest watch, :3000) + frontend (vite, :5173)
- `npm run lint` (eslint .) · `npm run format` / `format:check` (prettier) · `npm run typecheck`
- `npm test` — backend Jest + frontend vitest
- **Один backend-тест:** `npm test -w apps/backend -- auth/tma-validation` (аргумент — Jest path-паттерн, не путь к файлу)
- Frontend тесты: `npm test -w apps/frontend` (vitest run, jsdom)
- Prisma — **запускать из `apps/backend`**: `npm run prisma:migrate` (migrate dev), `npm run prisma:generate`
- Локальная инфра: `docker compose up -d`
- Перед коммитом: `npm run lint && npm run build && npm test`

## Gotchas (неочевидное, на чём споткнётся агент)

- **Build ordering.** `@hermes/shared` резолвится в `dist`, поэтому shared собирается **до** backend/frontend — корневые `build`/`dev`/`typecheck` делают это первым шагом. После правок в `packages/shared` пересобрать (`npm run build:shared`), иначе потребители видят старые типы; в `dev` следит `dev:shared` (tsc --watch).
- **НО backend-тесты мапят `@hermes/shared` на исходники** (`jest.config.js` `moduleNameMapper` → `packages/shared/src`). Тестам билд shared не нужен, а `build`/`typecheck`/runtime идут по `dist` — рассинхрон возможен.
- **NestJS DI: модули должны EXPORT провайдеры, которые потребляют другие модули.** `SubscriptionService` объявлен в `SubscriptionModule`, но `DeploysModule` импортирует `SubscriptionModule` и инжектит `SubscriptionService` в `DeploysService` — если `SubscriptionModule` не `exports: [SubscriptionService]`, prod падает на boot (`UnknownDependenciesException`). Typecheck и unit-тесты (фейки, без DI-контейнера) этого **не ловят** — только runtime. Всегда проверяй `exports` в новом модуле, если его сервисы используются за пределами модуля.
- **Env — два слоя, один корневой `.env`.** `apps/backend/src/env.ts` импортируется в самом верху `main.ts` (после `reflect-metadata`, до `AppModule`) и поднимает dotenv вверх по дереву (до 6 уровней) — единственный `.env` в корне монорепо виден backend'у из `apps/backend`. Тот же walk повторён в `prisma.config.ts`. `@nestjs/config` включён с `ignoreEnvFile: true` (файл уже загружен) + zod-валидация (`config/env.schema.ts`); `DRY_RUN` по умолчанию `true`. **Не создавать `apps/backend/.env`.**
- **Prisma — нестандартно.** Клиент генерируется в `apps/backend/src/generated/prisma` (не в `node_modules`), папка в `.gitignore` — после любой правки `schema.prisma` обязательно `npm run prisma:generate`, иначе не компилится. `prisma generate` требует `DATABASE_URL` (даже без реального коннекта) — `prisma.config.ts` сам поднимает её из `.env`. Миграции в проде накатываются автоматически при старте контейнера (`prisma migrate deploy` в `Dockerfile` CMD).
- **DI-конвенция.** Сервисы, зависящие от env/config, — обычные классы, принимающие **готовые значения в конструкторе**; модуль связывает через `useFactory` + `inject: [ConfigService]` (см. `SecretsModule`, `AuthModule`, `BotModule`, `ProvisioningModule`, `SubscriptionModule`, `OpenRouterKeysModule`, `TopupModule`). Не тянуть `ConfigService` внутрь сервисов — это держит их тестируемыми (в `*.spec.ts` инстанцируются с фейками напрямую).
- **Секреты.** Только через `SecretsService` (AES-256-GCM, формат `v1:base64(iv‖tag‖ciphertext)`, ключ `ENCRYPTION_KEY` = 64 hex = 32 байта). В БД только шифр (`*_enc` колонки). Не логировать, не отдавать в API, не хранить plaintext.
- **Frontend base path.** Vite `base: '/app/'` в prod (отдаётся бэкендом под `/app` через `SERVE_FRONTEND_DIR`), `/` в dev. Mini App — single-origin с бэкендом в проде.
- **Dokploy MCP.** Прод-инфра управляется через Dokploy (`https://dokploy.mxpkn8ns.ru`). MCP-сервер `@dokploy/mcp` подключён в `~/.config/opencode/opencode.jsonc` с `DOKPLOY_REDACT_ENV=true` (секреты редактируются в ответах). Теги: `application,deployment,docker,compose,domain,settings,postgres,redis`. Читай логи через `application-readLogs`, триггери redeploy через `application-redeploy`, проверяй контейнеры через `docker-getServiceContainersByAppName`. Swarm: если контейнер падает с `No such image` — образ не собрался (нужен redeploy), если `non-zero exit (1)` — читай логи приложения (`application-readLogs`).
- **Hostinger MCP.** В том же user-конфиге подключён `hostinger-vps-mcp` (62 VPS-tools: virtual-machines, docker manager, actions) с живым `HOSTINGER_API_TOKEN` — для отладки/инспекции VPS оператора. Действия, меняющие состояние/деньги (purchase/delete/recreate), — только с явного одобрения человека, как и любые живые вызовы Hostinger API.

## Code conventions

- TS strict; named exports (no default); валидация входа — zod через `common/zod-validation.pipe.ts` (ошибки → 400 с issues)
- NestJS-модуль: `<module>/{*.module.ts, *.service.ts, *.controller.ts, *.dto.ts}`
- Колокация тестов: backend `*.spec.ts` (Jest), frontend `*.test.ts(x)` (vitest) — рядом с исходником
- Комментарии в коде — только если просят

## Boundaries (КРИТИЧНО)

- **Не коммитить `.env` и секреты** (`.gitignore` исключает; shape — в `.env.example`).
- **`HOSTINGER_API_TOKEN` (в `.env`) — живой токен оператора.** Не логировать, не в репо, не хардкодить. Перед продом — ротация.
- **Не угадывать Hostinger API / Hermes setup** — всё сверено в `docs/architecture`; при пробеле спросить человека.
- **Не менять тариф/регион/template без подтверждения** (KVM 1, Vilnius id=11, template 1121 — зафиксированы).
- **`purchaseVM` списывает реальные деньги.** `DRY_RUN=true` (мок) в dev; реальные вызовы — только в чекпойнтах с явного одобрения. **В проде `DRY_RUN=false`** — каждый деплой из Mini App покупает реальный VPS с карты оператора.
- **Пуш в `main` автодеплоит прод** (Dokploy → `https://hermes.mxpkn8ns.ru`). Не пушить без зелёных lint/build/test.
- **Прод-`ENCRYPTION_KEY` (в Dokploy, ≠ локальный) не менять** — сломается расшифровка секретов в прод-БД.

## Env

Полный shape — в `.env.example` (включая `DEPLOY_WORKER_ENABLED`, `RECONCILE_DELETE_ORPHANS`, `SUBSCRIPTION_CHANNEL_ID`, `OPENROUTER_MANAGEMENT_KEY`, `OPENROUTER_KEY_LIMIT_USD`, `OPENROUTER_KEY_LIMIT_RESET`, `OPENROUTER_TOPUP_MARKUP_PERCENT`, `TOPUP_TIERS`, `SUBSCRIPTION_GRACE_DAYS`). Критичные: `DATABASE_URL`, `REDIS_URL`, `HOSTINGER_API_TOKEN`, `BOT_TOKEN`, `BOT_USE_WEBHOOK` (false=dev polling, true=prod webhook), `ENCRYPTION_KEY` (64 hex), `DRY_RUN`, `BACKEND_URL`, `MINI_APP_URL`, `SERVE_FRONTEND_DIR`, `SUBSCRIPTION_CHANNEL_ID`, `OPENROUTER_MANAGEMENT_KEY`.

Прод-значения живут в Dokploy (hermes-backend → Environment), не в репо: `BACKEND_URL=https://hermes.mxpkn8ns.ru`, `MINI_APP_URL=https://hermes.mxpkn8ns.ru/app/`, `BOT_USE_WEBHOOK=true`, `DRY_RUN=false`. **Phase 6 env настроены в проде** (2026-07): `SUBSCRIPTION_CHANNEL_ID` (id канала «Hermes»), `OPENROUTER_MANAGEMENT_KEY` (management-ключ из OpenRouter dashboard), `TOPUP_TIERS` (JSON массив тиров доплаты). Без `SUBSCRIPTION_CHANNEL_ID` + `OPENROUTER_MANAGEMENT_KEY` one-click деплой вернёт 402/401 — приложение стартует, но создание агента заблокировано.

## Status

**Phase 6 реализована 2026-07-11** (Tasks 19–25, arch §23). One-click bundle + Tribute billing работают в проде (`https://hermes.mxpkn8ns.ru`). Реализовано:

- Subscription module — Tribute channel-membership gating (`getChatMember` + `chat_member` update; `GET /subscription/status`, `POST /subscription/check`).
- OpenRouterKeys module — Management API (`createKey`/`raiseLimit`/`setDisabled`/`deleteKey`/`getKey`).
- DB migration — `openrouter_key_hash`, `subscription_channel_id/status/until`, `subscription_expired_at`, `bot_token_status`; `paid_until` удалён; `llm_key_enc` nullable (worker mintит managed key).
- One-click deploy flow — `POST /deploys` без `llm_key`/`llm_provider` (бэкенд ставит openrouter + worker mintит ключ); каталог → только `openrouter` (+ `custom` по `?advanced=1`); frontend: bot-token → оплата (Tribute deep-link) → статус.
- Topup — фиксированные Tribute tier-каналы (`POST /deploys/topup` с проверкой membership тир-канала → `raiseLimit`); кнопка «Пополнить токены» в кабинете.
- Bot-token recovery — `PATCH /deploys/:id/bot-token` (re-push env, VPS не трогается); hourly `getMe` healthcheck cron; badge «токен невалиден» + кнопка @BotFather.
- Subscription expiry — `chat_member left` → `disableKey`; renewal → `enableKey`; daily grace-teardown cron (`SUBSCRIPTION_GRACE_DAYS=7`).
- Каталог LLM (`shared/llm.ts`) сведён к `openrouter` + `custom`; `groq`/`proxyapi`/`vsegpt` удалены. Рендерер `hermes-config.ts` остался generic по `keyEnv`: one-click пишет `OPENROUTER_API_KEY`, а `custom`-провайдер (advanced) — `OPENAI_API_KEY` + обязательный `OPENAI_BASE_URL` (не выпиливать этот путь).
- UI: ценник убран из главного меню; экран «Об агенте» расширен (карточки возможностей, шаги, YouTube-обзоры).

317 тестов (281 backend Jest в 33 файлах + 36 frontend vitest в 4 файлах). Build/lint/typecheck зелёные (проверено 2026-07-18). Пуш в `main` автодеплоит прод через Dokploy.

**Live-статус агента (2026-07-18):** `GET /deploys/:id/live-status` (owner-checked, любой статус деплоя) — on-demand снапшот из Hostinger: `getVM` (state/ip) + `getDockerProjectContainers` (state/health). Толерантен: VM 404 → `vm_state: null`, project 404/422 → `containers: []`; прочие ошибки Hostinger пробрасываются. Frontend: кнопка «Проверить состояние» в AgentDetail.

**Прод-чекпойнт Phase 6 — пройден (2026-07-18):** env настроены, живой клиент оплатил подписку и развернул агента end-to-end (оплата → membership → деплой → агент отвечает).

**Открытые вопросы:** Tribute API (нет), реселлерские ToS Hostinger (не подтверждены), Managed Bots (Bot API 9.6 — отложено отдельной фазой), dev/prod split (отдельный бот и окружение для dev — пока один прод-бот, локальный dev через `VITE_DEV_INIT_DATA`).
