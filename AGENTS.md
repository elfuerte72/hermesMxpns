# AGENTS.md — Hermes Deployer

Project root entry point. **Read this first**, then `docs/intent/hermes-deployer.md` → `docs/architecture/hermes-deployer.md` → `docs/plan/hermes-deployer.md`.

## What this is
One-click деплой Hermes-агента (Nous Research) для нетехнического клиента через Telegram Mini App. Клиент вводит bot token + LLM-провайдер + LLM-ключ → бэкенд поднимает Hostinger VPS через post-install script → Hermes стартует без SSH → клиент получает бота в Telegram. Коммерческое, подписка, маржа ~30% поверх себестоимости VPS.

## Doc map (read order)
1. `docs/intent/hermes-deployer.md` — подтверждённое намерение (what/why/success/constraints/out-of-scope)
2. `docs/architecture/hermes-deployer.md` — технический референс: проверенные факты Hostinger API, Hermes setup, LLM-провайдеры, модель данных, API, flow, безопасность. **Все факты sourced — не переследовать, не угадывать.**
3. `docs/plan/hermes-deployer.md` — фазы и задачи (Task 1 → Task 18, чекпойнты). Реализовывать строго по фазам, вертикальными срезами.

## Tech stack
- **Backend:** NestJS + TypeScript (Node 20+), Prisma, BullMQ, grammY, `hostinger-api-sdk`, `ssh2`
- **Frontend (Mini App):** React 18 + Vite + TypeScript + `@telegram-apps/sdk-react` + Tailwind
- **Infra:** PostgreSQL, Redis (docker compose локально)
- **Monorepo:** npm workspaces — `apps/backend`, `apps/frontend`, `packages/shared`

## Commands (устанавливаются в Task 1; следовать этим паттернам)
- Build all: `npm run build`
- Lint: `npm run lint`
- Dev: `npm run dev` (поднимает backend + frontend)
- Backend tests: `npm test -w apps/backend`
- Prisma migrate: `npx prisma migrate dev` (из `apps/backend`)
- Prisma generate: `npx prisma generate`
- Local infra: `docker compose up -d` (Postgres + Redis)
- Type check: `npx tsc --noEmit`

## Code conventions
- TypeScript strict mode везде; named exports (no default exports)
- NestJS: модульная структура (`src/<module>/{<module>.module.ts, *.service.ts, *.controller.ts, *.dto.ts}`)
- DTOs с zod или class-validator; валидация на входе всех endpoints
- Секреты — только через `SecretsModule` (AES-256-GCM), никогда не в логах, не в ответах API, не plaintext в БД
- Колокация тестов: `*.spec.ts` рядом с исходником
- Коммиты — только когда явно просят; сообщение — кратко, в стиле репо
- Не добавлять комментарии в код, если не просят

## Boundaries (КРИТИЧНО)
- **Никогда не коммитить `.env` и секреты.** `.gitignore` уже исключает `.env`.
- **Hostinger API-токен лежит в `.env` (`HOSTINGER_API_TOKEN`).** Это живой токен оператора. Не логировать, не отправлять в репо, не хардкодить. Перед продом — ротировать.
- **Не угадывать Hostinger API / Hermes setup** — всё сверено в `docs/architecture`. Если факт нужен и его там нет — спросить человека, не изобретать.
- **Не менять тариф/регион/template** без подтверждения (KVM 1, Vilnius id=11, template 1121 — зафиксированы).
- **`purchaseVM` списывает реальные деньги.** В dev использовать флаг `DRY_RUN=true` (мок Hostinger), реальные вызовы — только в чекпойнтах с явного одобрения.
- Перед коммитом: `npm run lint && npm run build && npm test` (когда настроено).

## Env (`.env`, gitignored; shape в `.env.example`)
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hermes_deployer
REDIS_URL=redis://localhost:6379
HOSTINGER_API_TOKEN=<в .env>           # оператора, не коммитить
BOT_TOKEN=<твой Telegram-бот-токен>     # entry-бота, получить у @BotFather
ENCRYPTION_KEY=<32-byte hex>            # для AES-GCM, сгенерировать
BACKEND_URL=https://<публичный-домен>   # для webhook'ов и bootstrap-pull
MINI_APP_URL=https://<домен-mini-app>
DRY_RUN=true                            # мок Hostinger в dev
```

## How to start (для свежего агента)
1. Прочитать три дока выше.
2. Начать с **Phase 1, Task 1** из `docs/plan/hermes-deployer.md` (скаффолд монорепо).
3. Идти строго по фазам; после каждой фазы — чекпойнт (см. план). На чекпойнте停下来 и ревью с человеком.
4. Использовать `incremental-implementation` и `test-driven-development` скиллы; каждая задача = вертикальный срез с acceptance criteria и verification.
5. Все технические факты брать из `docs/architecture`; если устарели — обновлять док, а не молча отклоняться.

## Status
Greenfield. Кода пока нет. Git не инициализирован (Task 1 инициализирует). Контекстные доки готовы.
