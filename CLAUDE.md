# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`AGENTS.md` — единый источник правды по намерению, стеку, конвенциям и **boundaries** (секреты, живой Hostinger-токен, `DRY_RUN`, зафиксированные тариф/регион/template). Прочитать его перед работой; ниже — только то, что дополняет его (архитектура «между файлами» + команды). Doc-driven: контекст в `docs/intent/` → `docs/architecture/` → `docs/plan/`. Факты Hostinger/Hermes сверены в `docs/architecture` — не угадывать, при пробеле спросить человека.

**Статус:** MVP код-комплит на моках — Tasks 1–18 закрыты (полный backend-флоу: deploys → BullMQ-воркер → Docker Manager API → ready; teardown, reconcile-cron, watchdog; Mini App UI). 164 теста: 149 backend (Jest) + 15 frontend (vitest). **Прод развёрнут в Dokploy:** `https://hermes.mxpkn8ns.ru` (single-origin: backend отдаёт Mini App под `/app/`; ранбук — `docs/deploy/dokploy.md`). Чекпойнт реального деплоя начат 2026-07-05: на проде `DRY_RUN=false`, живой прогон дошёл до `purchaseVM` (платёж отклонён банком — fail-path проверен боем: `failed` без ретрая и без orphan-VM); happy-path ждёт пополнения карты. Автодеплой из `main` работает через GitHub-webhook (настроен 2026-07-05). Открыто: завершение чекпойнта и Phase 6 (биллинг Telegram Stars).

## Commands (запускать из корня, если не сказано иное)

- `npm run build` / `npm run dev` — оба скрипта **сначала собирают `@hermes/shared`**, потом backend+frontend (см. build ordering ниже).
- `npm run lint` — eslint по всему репо. `npm run format` / `npm run format:check` — prettier.
- `npm run typecheck` — `tsc` по shared (build) + `--noEmit` по backend и frontend.
- `npm test` → backend Jest. Один тест: `npm test -w apps/backend -- auth/tma-validation` (передаётся как path-паттерн Jest).
- Backend dev в одиночку: `npm run dev:backend` (nest watch, порт 3000).
- Локальная инфра: `docker compose up -d` (Postgres :5432 + Redis :6379).
- Prisma (**из `apps/backend`**): `npm run prisma:migrate` (migrate dev), `npm run prisma:generate`.
- Прод-образ: корневой `Dockerfile` (multi-stage; на старте контейнера — `prisma migrate deploy`, статика фронта под `/app` через `SERVE_FRONTEND_DIR`). **Пуш в `main` автодеплоит прод** (Dokploy Autodeploy) — не пушить без зелёных lint/build/test.

## Архитектура

**Монорепо, три workspace'а:** `packages/shared` (общие типы + чистые функции: `hostinger.ts`, `llm.ts`, `auth.ts`, `api.ts`), `apps/backend` (NestJS), `apps/frontend` (Vite + React 19 + TMA SDK + Tailwind 4). Оба приложения импортируют `@hermes/shared`.

**Build ordering (важно):** `@hermes/shared` резолвится в свой `dist` (`main`/`types` указывают на `dist`), а не на исходники. Поэтому shared надо собрать **до** backend/frontend — корневые `build`/`dev`/`typecheck` уже делают это первым шагом. После правок в `packages/shared` пересобрать его (`npm run build:shared`), иначе потребители видят старые типы. В `dev` за этим следит `tsc --watch` через `dev:shared`.

**DI-конвенция (сквозная):** сервисы, зависящие от env, — обычные классы, принимающие **готовые значения в конструкторе**, а модуль связывает их через `useFactory` + `inject: [ConfigService]`. Так сделано в `SecretsModule`, `AuthModule`, `BotModule`, `ProvisioningModule`. Это держит сервис-классы чистыми и легко тестируемыми (в `*.spec.ts` инстанцируются напрямую с фейковыми значениями). Новые config-зависимые сервисы делать так же, а не тянуть `ConfigService` внутрь сервиса.

**Env — два слоя.** (1) `src/env.ts` импортируется **первой строкой** `main.ts`: dotenv идёт вверх по дереву (до 6 уровней) в поисках `.env` — поэтому монорепный `.env` в корне виден backend'у из его подпапки. (2) `ConfigModule` подключает `@nestjs/config` с `ignoreEnvFile: true` (файл уже загружен слоем 1) и **zod-валидацией** через `config/env.schema.ts`. Схема приводит типы (`BOT_USE_WEBHOOK`/`DRY_RUN` → boolean, `PORT` → number) и падает с внятной ошибкой при отсутствии обязательного. `DRY_RUN` по умолчанию `true`.

**Prisma — нестандартно.** Клиент генерируется провайдером `prisma-client` (новый) в **`apps/backend/src/generated/prisma`**, а не в `node_modules` — эта папка в `.gitignore` и в eslint/ts-ignore, но нужна для компиляции: после изменения `schema.prisma` обязательно `prisma:generate`. Подключение — через driver adapter `@prisma/adapter-pg` (`PrismaService` создаёт `PrismaClient` с `PrismaPg` от `DATABASE_URL`). Схема: `User`(telegram_id BigInt PK) → `Deploy` → `ProvisioningLog`; колонки snake_case через `@@map`; `DeployStatus` enum (`pending`→`ready`/`failed`).

**Секреты.** `SecretsService` — AES-256-GCM, формат `v1:base64(iv‖tag‖ciphertext)`, ключ из `ENCRYPTION_KEY` (ровно 64 hex = 32 байта). В БД лежат `bot_token_enc`/`llm_key_enc` (только шифр). Работать с секретами только через этот сервис; не логировать, не отдавать в API.

**Auth (Telegram Mini App).** `TmaAuthGuard` берёт `Authorization`, `parseTmaAuthHeader` (shared) достаёт initData, `AuthService.authenticate` проверяет HMAC-подпись Telegram + freshness (`validateInitData` в `auth/tma-validation.ts`), затем upsert юзера по `telegram_id`. Провал → 401 с кодом ошибки.

**Provisioning.** Тонкая обёртка над официальным `hostinger-api-sdk`: маппит SDK-ресурсы в `Hostinger*`-типы из shared. `purchaseVM` **тратит реальные деньги** → только под `DRY_RUN`/чекпойнтом. `deleteVM` идёт сырым axios (нет в SDK). Deploy-flow (с 2026-07-05, см. architecture §19): воркер покупает VM, ждёт `running`, расшифровывает секреты и пушит Hermes-проект напрямую через Docker Manager API (`createDockerProject`: compose без секретов, секреты в project-`.env`), поллит контейнеры до `running` → `ready`. Post-install script / bootstrap-pull / webhook выпилены.

**Bot.** grammY entry-бот. `BOT_USE_WEBHOOK`: `false` = long-polling (dev), `true` = webhook на `/bot/<token>`. Нет `BOT_TOKEN` → бот выключен (варнинг, не падение).

## Конвенции (сверх ESLint/Prettier)

- Named exports, без default. Валидация входа — zod через `common/zod-validation.pipe.ts` (`ZodValidationPipe`, ошибки → 400 с issues).
- NestJS-модуль: `<module>/{*.module.ts, *.service.ts, *.controller.ts, *.dto.ts}`, тесты `*.spec.ts` колокейтятся рядом.
- Комментарии в коде — только если просят.
