# AGENTS.md — Hermes Deployer

Project root entry point. **Read this first**, then `docs/intent/hermes-deployer.md` → `docs/architecture/hermes-deployer.md` → `docs/plan/hermes-deployer.md`.

## What this is

One-click деплой Hermes-агента (Nous Research) для нетехнического клиента через Telegram Mini App. Клиент вводит bot token + LLM-провайдер + LLM-ключ → бэкенд поднимает Hostinger VPS и пушит Hermes-проект через Docker Manager API → Hermes стартует без SSH → клиент получает бота в Telegram. Коммерческое, подписка, маржа ~30% поверх себестоимости VPS.

## Doc map (read order)

1. `docs/intent/hermes-deployer.md` — подтверждённое намерение (what/why/success/constraints/out-of-scope)
2. `docs/architecture/hermes-deployer.md` — технический референс: проверенные факты Hostinger API, Hermes setup, LLM-провайдеры, модель данных, API, flow, безопасность. **Все факты sourced — не переследовать, не угадывать.**
3. `docs/plan/hermes-deployer.md` — фазы и задачи (Task 1 → Task 18, чекпойнты). Реализовывать строго по фазам, вертикальными срезами.
4. `docs/deploy/dokploy.md` — прод-развёртывание (Dokploy: сервисы, домен, env, ограничения IP-проверки).

## Tech stack

- **Backend:** NestJS + TypeScript (Node 20+), Prisma, BullMQ, grammY, `hostinger-api-sdk` (`ssh2`-recovery не понадобился — Docker Manager API работает без SSH, в зависимостях его нет)
- **Frontend (Mini App):** React 19 + Vite + TypeScript + Tailwind; вместо `@telegram-apps/sdk-react` — свой мост `telegram.ts` над `window.Telegram.WebApp` (см. arch §14/§17)
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
- **`purchaseVM` списывает реальные деньги.** В dev использовать флаг `DRY_RUN=true` (мок Hostinger), реальные вызовы — только в чекпойнтах с явного одобрения. **В проде (Dokploy) с 2026-07-05 стоит `DRY_RUN=false`** — каждый деплой из Mini App покупает реальный VPS с карты оператора.
- **Пуш в `main` автодеплоит прод** (Dokploy Autodeploy → `https://hermes.mxpkn8ns.ru`). Не пушить без зелёных lint/build/test.
- **Прод-`ENCRYPTION_KEY` (задан в Dokploy, отличается от локального) не менять** — сломается расшифровка секретов в прод-БД.
- Перед коммитом: `npm run lint && npm run build && npm test`.

## Env (`.env`, gitignored; shape в `.env.example`)

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hermes_deployer
REDIS_URL=redis://localhost:6379
HOSTINGER_API_TOKEN=<в .env>           # оператора, не коммитить
BOT_TOKEN=<твой Telegram-бот-токен>     # entry-бота, получить у @BotFather
BOT_USE_WEBHOOK=false                   # false=long polling (dev), true=webhook (prod)
TMA_AUTH_MAX_AGE_SECONDS=86400          # freshness-окно Telegram initData (24h)
ENCRYPTION_KEY=<32-byte hex>            # для AES-GCM, сгенерировать
BACKEND_URL=https://<публичный-домен>   # для Telegram-вебхука бота
MINI_APP_URL=https://<домен-mini-app>
DRY_RUN=true                            # мок Hostinger в dev
# SERVE_FRONTEND_DIR=<путь к apps/frontend/dist>  # отдавать Mini App с бэкенда под /app (прод)
```

Прод-значения env живут в Dokploy (hermes-backend → Environment), не в этом репо. `BACKEND_URL=https://hermes.mxpkn8ns.ru`, `MINI_APP_URL=https://hermes.mxpkn8ns.ru/app/`, `BOT_USE_WEBHOOK=true`.

## How to start (для свежего агента)

1. Прочитать доки выше (intent → architecture → plan → deploy).
2. Сверить статус в `CLAUDE.md` и открытые чекпойнты в `docs/plan/hermes-deployer.md`.
3. Использовать `incremental-implementation` и `test-driven-development` скиллы; каждая задача = вертикальный срез с acceptance criteria и verification.
4. Все технические факты брать из `docs/architecture`; если устарели — обновлять док, а не молча отклоняться.

## Status

MVP код-комплит на моках (Tasks 1–18, 164 теста: 149 backend + 15 frontend; доставка секретов через Docker Manager API — arch §19). Прод задеплоен в Dokploy: `https://hermes.mxpkn8ns.ru` (Postgres+Redis как сервисы Dokploy, приложение из корневого `Dockerfile`, Mini App под `/app/`, автодеплой из `main`) — см. `docs/deploy/dokploy.md`. Открыто: ручной прогон Mini App в Telegram (Web App URL в BotFather), чекпойнт реального деплоя VPS (`DRY_RUN=false`, только с одобрения человека), Phase 6 — биллинг Telegram Stars.
