# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`AGENTS.md` — единый источник правды по намерению, стеку, конвенциям и **boundaries** (секреты, живой Hostinger-токен, `DRY_RUN`, зафиксированные тариф/регион/template). Прочитать его перед работой; ниже — только то, что дополняет его (архитектура «между файлами» + команды). Doc-driven: контекст в `docs/intent/` → `docs/architecture/` → `docs/plan/`. Факты Hostinger/Hermes сверены в `docs/architecture` — не угадывать, при пробеле спросить человека.

**Статус:** MVP работает end-to-end в проде. **Чекпойнт реального деплоя пройден 2026-07-05** — живой клиент из Telegram развернул агента (VPS куплен → Hermes через Docker Manager → бот отвечает; `chat_id`/allowed-user подставляется автоматически из TMA-`initData`, ручной терминал не нужен). Прод: `https://hermes.mxpkn8ns.ru` (Dokploy, single-origin `/app/`, автодеплой из `main` через GitHub-webhook; `DRY_RUN=false`). 232 теста (200 backend Jest + 32 frontend vitest).

Что добавилось за 2026-07-05 (см. architecture §19–§21):
- Доставка секретов — **Docker Manager API** (post-install/bootstrap/webhook выпилены).
- Каталог LLM v2 с оплатой из РФ (Groq/ProxyAPI/VseGPT/OpenRouter/custom) + `validate-llm-key` с пробами chat/tools/stream.
- Устойчивость к гонке оплаты Hostinger (402/деклайн): **self-heal** — воркер подхватывает уже оплаченную KVM 1 (Vilnius, <24ч, не занятую активным деплоем) вместо новой покупки; при сбое adopted-VM не удаляется.
- CPU-лимит контейнера `1.0` (KVM 1 = 1 vCPU; `2.0` не давал контейнеру стартовать).
- **Личный кабинет «Мои агенты»**: список + `POST /deploys/:id/restart`, `PATCH /deploys/:id/llm-key` (owner-checked, ready-only), удаление; teardown не удаляет VM, занятую другим активным деплоем.
- Пиксельный игровой UI (Press Start 2P, вордмарк-логотип).

Открыто: Phase 6 (биллинг Telegram Stars), опц. транзакционность смены ключа. **`DRY_RUN=false` в проде — каждый деплой тратит реальные деньги оператора.**

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

**Provisioning.** Тонкая обёртка над официальным `hostinger-api-sdk`: маппит SDK-ресурсы в `Hostinger*`-типы из shared. `purchaseVM` **тратит реальные деньги**. `deleteVM` идёт сырым axios (нет в SDK). Deploy-flow (с 2026-07-05, см. architecture §19): воркер **acquireVm** (сначала self-heal — подхват уже оплаченной свободной KVM 1; иначе purchase, толерантный к 402-гонке) → ждёт `running` → расшифровывает секреты → пушит Hermes-проект через Docker Manager API (`createDockerProject`: compose без секретов + `cpus: 1.0`, секреты в project-`.env`, `TELEGRAM_ALLOWED_USERS`/`TELEGRAM_BOT_TOKEN` из деплоя) → поллит контейнеры до `running` → `ready`. Post-install script / bootstrap-pull / webhook выпилены. Управление после деплоя (кабинет): `restartDockerProject`, `updateDockerProject` (re-push нового env через `createNewProjectV1`-overwrite — `updateProjectV1` не несёт body). Teardown удаляет VM только если её не держит другой активный деплой.

**Bot.** grammY entry-бот. `BOT_USE_WEBHOOK`: `false` = long-polling (dev), `true` = webhook на `/bot/<token>`. Нет `BOT_TOKEN` → бот выключен (варнинг, не падение).

## Конвенции (сверх ESLint/Prettier)

- Named exports, без default. Валидация входа — zod через `common/zod-validation.pipe.ts` (`ZodValidationPipe`, ошибки → 400 с issues).
- NestJS-модуль: `<module>/{*.module.ts, *.service.ts, *.controller.ts, *.dto.ts}`, тесты `*.spec.ts` колокейтятся рядом.
- Комментарии в коде — только если просят.
