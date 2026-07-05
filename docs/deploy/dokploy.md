# Deploy: Dokploy (прод control-plane)

Бэкенд + Mini App выкатываются одним Docker-образом (корневой `Dockerfile`): NestJS отдаёт API и статику фронта под `/app` (single-origin). Postgres и Redis — сервисы Dokploy рядом. HTTPS терминирует Traefik Dokploy (Let's Encrypt). Туннель (ngrok/cloudflared) больше не нужен.

## Что делает образ

- Multi-stage: `npm ci` → `prisma generate` → сборка shared/backend/frontend (фронт собирается с `base=/app/`, API-запросы same-origin).
- Runtime: только prod-зависимости; `SERVE_FRONTEND_DIR` уже вшит.
- На старте контейнера: `prisma migrate deploy` (миграции применяются автоматически), затем `node dist/main.js`.
- `HEALTHCHECK` дёргает `GET /health`.

## Шаги в Dokploy

1. **Сервисы БД**: в проекте Dokploy создать PostgreSQL 16 (`hermes_deployer`) и Redis 7. Хосты для env — internal-имена сервисов в docker-сети Dokploy (видны в UI сервиса), не `localhost`.
2. **Application**: источник — этот git-репозиторий, ветка `main`, Build Type = Dockerfile (путь `./Dockerfile`, контекст — корень).
3. **Домен**: привязать домен, включить HTTPS (Let's Encrypt), container port `3000`.
4. **Environment** (см. `.env.example`):

   ```
   DATABASE_URL=postgresql://<user>:<pass>@<internal-postgres-host>:5432/hermes_deployer
   REDIS_URL=redis://<internal-redis-host>:6379
   HOSTINGER_API_TOKEN=<ротировать перед продом>
   BOT_TOKEN=<токен entry-бота>
   BOT_USE_WEBHOOK=true
   ENCRYPTION_KEY=<openssl rand -hex 32; НЕ менять после первых записей — расшифровка сломается>
   BACKEND_URL=https://<домен>
   MINI_APP_URL=https://<домен>/app/
   DRY_RUN=true
   TMA_AUTH_MAX_AGE_SECONDS=86400
   ```

   `DRY_RUN=false` — только на чекпойнте реального деплоя, с явного одобрения (тратит реальные деньги).

5. **Deploy** и проверить:
   - `GET https://<домен>/health` → `{"status":"ok"}`;
   - `GET https://<домен>/health/db` → счётчик users (миграции применились);
   - `https://<домен>/app/` отдаёт Mini App;
   - логи приложения: бот зарегистрировал webhook (`BOT_USE_WEBHOOK=true` → `setWebhook` на `/bot/<token>`).
6. **BotFather**: у entry-бота настроить Web App / Menu Button на `MINI_APP_URL`. После этого `/start` у бота открывает Mini App по HTTPS — можно проходить полный флоу в настоящем Telegram.

## Ограничения и заметки

- Доставка секретов на клиентские VPS идёт через Hostinger Docker Manager API (с 2026-07-05, см. architecture §19) — публичных `/bootstrap` и `/webhooks/deploy-ready` больше нет, клиентские VPS бэкенд не вызывают.
- Порт 3000 наружу не публиковать — только через Traefik.
- `BACKEND_URL` обязан быть публичным HTTPS только для Telegram-вебхука бота (`BOT_USE_WEBHOOK=true`).
- Смена схемы БД: миграции накатываются при рестарте контейнера (`migrate deploy`), отдельного шага не нужно.
- Ручные SQL по прод-БД — через Dokploy: сервис `hermes-postgres` → **Open Terminal** → `psql -U postgres -d hermes_deployer -c "…"`. Внешний `:5432` на хосте — это Postgres самого Dokploy, не наш (снаружи к `hermes_deployer` не подключиться). Удаление строк `deploys` **не трогает VPS** (в отличие от teardown) — безопасно для чистки мусорных/проваленных записей.
- MCP `hostinger-api` (обёртка над Hostinger API) подключён в Claude Code (`claude mcp add hostinger-api`). Для диагностики контейнера Hermes на клиентском VPS (когда `docker compose up` «успех», но 0 контейнеров) — браузер-терминал VPS в hPanel: `docker ps -a`, `cd /docker/<project> && docker compose up -d` покажет реальную ошибку (API docker-logs отдаёт «project not found» при 0 контейнеров).
