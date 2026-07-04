# Hermes Deployer — Intent

> Подтверждённое заявление о намерении. Источник: сессия interview-me. Не spec и не задача — это вход для spec/плана.

## Outcome
One-click деплой Hermes Agent (Nous Research) для нетехнического клиента через Telegram Mini App. Клиент вводит Telegram bot token + LLM-провайдер + LLM API-ключ, жмёт «Деплой» — получает работающего бота в Telegram без VPS/SSH/терминала.

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
Подписка за агент/мес. Оператор несёт стоимость Hostinger-VPS (~$4–5/мес на клиента по каталогу). Цена = себестоимость + ~30% маржа.

## Constraints
- VPS-провайдер: **Hostinger** (Hetzner отпал).
- Один агент для MVP: **Hermes only** (OpenClaw вне скоупа).
- Клиент даёт upfront: Telegram bot token + LLM-провайдер + LLM API-ключ. Дефолтного LLM-ключа от оператора нет.
- Стек: **Node.js/TypeScript** — NestJS + grammY + Prisma + официальный `hostinger-api-sdk`; фронт React + Vite + TS TMA.

## Key technical decisions (verified)
- **Провижининг**: Hostinger post-install scripts (`POST /api/vps/v1/post-install-scripts`) — скрипт сохраняется в `/post_install`, выполняется один раз после установки VM, лог в `/post_install.log`, макс. 48KB. `user_data`/cloud-init в API нет — post-install script это аналог.
- **Флоу**: создать скрипт → `POST /api/vps/v1/virtual-machines` (purchase) c `setup{template_id, data_center_id, post_install_script_id}` → VM ставит ОС и автоматически выполняет скрипт.
- **Доставка секретов**: post-install script идёт **без секретов**. VPS тянет bot token + LLM-ключ с бэкенда по HTTPS одноразовым bootstrap-токеном; бэкенд сверяет IP звонящего с IP виртуалки, токен горит после использования. Иначе секреты лежали бы в account-scoped скрипте Hostinger (видны всем с твоим Hostinger-токеном).
- **LLM-провайдеры**: Hermes `custom_providers` в `~/.hermes/config.yaml` (Groq/Gemini/OpenRouter сверены). Mini App даёт меню выбора.

## Out of scope (MVP)
- Второй агент (OpenClaw).
- Авто-ротация / дефолтные LLM-ключи от оператора.
- Сложный биллинг v1 (минимальный модуль подписки).
- Своя модель / файн-тюн.

## Architecture summary
NestJS-модули: `Auth` (TMA initData), `Deploys`, `Provisioning` (Hostinger SDK), `LlmProviders`, `Bootstrap` (one-time secret pull), `Webhooks`, `Workers` (BullMQ), `Bot` (grammY), `Secrets` (AES-GCM), `Billing` (phase 2).
Данные: `User`, `Deploy`, `ProvisioningLog`, `Subscription/Payment` (p2).
Control-plane: один микро-VPS (NestJS + Postgres + Redis). Клиентские VPS: Hostinger, по требованию.

## Deploy flow (refined)
1. TMA-форма → `validate-bot-token` (Telegram getMe) → выбор провайдера + ключ → `POST /deploys`.
2. Бэкенд: шифрует секреты, создаёт `Deploy(pending)` + одноразовый bootstrap-токен, ставит job в очередь.
3. Worker: создаёт post-install script (без секретов) → `POST /virtual-machines` с setup → поллит `/actions` до installed.
4. На VPS `/post_install`: `curl install Hermes` → `GET /bootstrap/:id?token=…` (тянет секреты, IP-проверка) → пишет `.env`+`config.yaml` → `hermes gateway run` → `POST /webhooks/deploy-ready`.
5. Бэкенд: инвалид bootstrap-токен, `status=ready`, бот уведомляет клиента. Сбой → cleanup VPS + `failed`.
