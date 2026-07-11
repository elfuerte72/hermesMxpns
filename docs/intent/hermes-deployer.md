# Hermes Deployer — Intent

> Подтверждённое заявление о намерении. Источник: сессия interview-me. Не spec и не задача — это вход для spec/плана.

## Outcome

One-click деплой Hermes Agent (Nous Research) для нетехнического клиента через Telegram Mini App. Клиент платит подписку → бэкенд создаёт managed OpenRouter-ключ (с token-cap) и разворачивает агента → клиент получает работающего бота в Telegram без VPS/SSH/терминала и без похода за API-ключом. Bot token клиент всё ещё создаёт сам в @BotFather (один клик из Mini App).

## User

Нетехнический юзер, которому нужен свой Hermes-агент, но VPS/шлюз/терминал — не для него.

## Why now

- Hermes зрелый: docker-compose + scriptable setup, поддержка custom OpenAI-compatible провайдеров (Groq/Gemini/OpenRouter/Together/Perplexity — сверено с доками `/nousresearch/hermes-agent`).
- Telegram Mini App даёт платформу доставки и бесплатную идентичность (`initData`).
- Hostinger API поддерживает **post-install scripts** (сверено с `openapi.json` v1.2.1 репо `hostinger/api`) — полностью автоматический, без-SSH провижининг.
- Ручной путь (купить Hostinger VPS → SSH → `hermes gateway setup` в терминале) — та самая боль, которую убираем.

## Success

Клиент без техзнаний поднимает рабочего Hermes-бота < 3 мин и ~5 кликов, без единой команды в терминале; бот отвечает на первое сообщение.

## Commercial model

Подписка за агент/мес — **bundle «VPS + OpenRouter-ключ с cap»**. Платёжка — **Tribute** (`@tribute`, рубли, карта Мир, комиссия 10%, выплаты на карту 2×/мес). Прайс **7900 ₽/мес** (~$86) при себестоимости $59.49 (VPS monthly $19.49 + OpenRouter limit $40) → ~30% маржа после Tribute. Доплата при исчерпании token-cap: +25% (наценка >10% перекрывает комиссию Tribute). Оператор несёт оборотный капитал на OpenRouter-депозит (foreign card/крипта; Mir не принимается).

## Constraints

- VPS-провайдер: **Hostinger** (Hetzner отпал).
- Один агент для MVP: **Hermes only** (OpenClaw вне скоупа).
- **One-click bundle — единственный advertised путь:** оператор выдаёт managed OpenRouter-ключ (per-user, spend-cap встроен апстримом). BYOK (`custom` провайдер) остаётся в коде как скрытый «Advanced» для power-users, не показывается в основном UI.
- Клиент даёт upfront: **только Telegram bot token** (создаёт в @BotFather) + оплату подписки. LLM-ключ от оператора, не от клиента.
- Платёжка — **Tribute** (рубли/Mir). Telegram Stars отклонён: вывод только в TON через Fragment + двойная комиссия (сторы на входе + Telegram на выводе), существенно дороже 10% Tribute.
- Стек: **Node.js/TypeScript** — NestJS + grammY + Prisma + официальный `hostinger-api-sdk`; фронт React + Vite + TS TMA.

## Key technical decisions (verified)

- **Провижининг**: Hostinger post-install scripts (`POST /api/vps/v1/post-install-scripts`) — скрипт сохраняется в `/post_install`, выполняется один раз после установки VM, лог в `/post_install.log`, макс. 48KB. `user_data`/cloud-init в API нет — post-install script это аналог.
- **Флоу**: создать скрипт → `POST /api/vps/v1/virtual-machines` (purchase) c `setup{template_id, data_center_id, post_install_script_id}` → VM ставит ОС и автоматически выполняет скрипт.
- **Доставка секретов**: post-install script идёт **без секретов**. VPS тянет bot token + LLM-ключ с бэкенда по HTTPS одноразовым bootstrap-токеном; бэкенд сверяет IP звонящего с IP виртуалки, токен горит после использования. Иначе секреты лежали бы в account-scoped скрипте Hostinger (видны всем с твоим Hostinger-токеном).
- **LLM-провайдеры**: Hermes `custom_providers` в `~/.hermes/config.yaml` (Groq/Gemini/OpenRouter сверены). Mini App даёт меню выбора.

## Out of scope (MVP)

- Второй агент (OpenClaw).
- Своя модель / файн-тюн.
- Несколько тарифов (один tier: $40 OpenRouter limit). Тиры — после данных о реальном потреблении.
- Free trial (сразу оплата — нет абьюза бесплатными VPS за счёт оператора).
- Telegram Stars как платёжка (отклонён по экономике, см. Constraints).

## Architecture summary

NestJS-модули: `Auth` (TMA initData), `Deploys`, `Provisioning` (Hostinger SDK), `LlmProviders`, `Bot` (grammY), `Secrets` (AES-GCM), `Subscription` (Tribute channel-membership gating), `OpenRouterKeys` (Management API), `Workers` (BullMQ). `Bootstrap`/`Webhooks` выпилены в §19-рефакторе (Docker Manager API).
Данные: `User`, `Deploy`, `ProvisioningLog`. Phase 6 добавляет на `Deploy`: `openrouter_key_hash`, `subscription_channel_id`, `subscription_status`; `paid_until` (vestigial) — дропнуть.
Control-plane: один микро-VPS (NestJS + Postgres + Redis). Клиентские VPS: Hostinger, по требованию.

## Deploy flow (refined — Phase 6 one-click bundle, реализовано 2026-07-11)

1. Mini App: юзер жмёт «Создать агента» → создаёт bot в @BotFather (кнопка `/botfather` → `openTelegramLink`) → вставляет token → **экран оплаты** (переход в @tribute, подписка 7900 ₽/мес).
2. Юзер оплатил → @tribute добавил его в закрытый канал «Hermes» → entry-бот получает `chat_member` update (или бэкенд поллит `getChatMember`) → `subscription_status=active`.
3. Бэкенд: `POST /api/v1/keys` (OpenRouter Mgmt API, limit 40, monthly) → ключ шифруется в `llm_key_enc`, `hash` в БД → `POST /deploys` (только bot_token; provider=openrouter; LLM-ключ от оператора) → BullMQ-job.
4. Worker (§19): `acquireVm` → `running` → `resolveLlmKey` (mint managed key) → `createDockerProject` (`OPENROUTER_API_KEY` + config.yaml с `custom_providers: openrouter`) → поллинг контейнеров до `running` → `ready`.
5. Cap исчерпан (OpenRouter 402): кабинет «пополнить» → юзер подписывается на tier-канал Tribute → `POST /deploys/topup` (проверка membership тир-канала) → `PATCH /api/v1/keys/{hash}` (limit += N). Re-push env **не нужен**.
6. Подписка истекла (Tribute убрал из канала): `chat_member` update → `subscription_status=expired` → `disableKey` (агент заморожен). Daily cron: past grace (`SUBSCRIPTION_GRACE_DAYS=7`) → teardown.
7. Bot-token невалиден: hourly healthcheck `getMe` → `bot_token_status=invalid` → кабинет → `PATCH /deploys/:id/bot-token` → re-push (VPS не трогается).
