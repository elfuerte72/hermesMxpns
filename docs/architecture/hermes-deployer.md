# Architecture: Hermes Deployer

> Технический референс для реализации. Все факты проверены по первоисточникам (см. «Sources»). Свежий агент читает этот файл + `docs/plan/hermes-deployer.md` перед стартом.

## 1. Что строим
One-click деплой Hermes Agent (Nous Research) для нетехнического клиента через Telegram Mini App. Клиент вводит bot token + LLM-провайдер + LLM-ключ → бэкенд через Hostinger API поднимает VPS с post-install script → Hermes настраивается без SSH и стартует → клиент получает работающего бота в Telegram.

## 2. Стек
| Слой | Технология |
|---|---|
| Mini App (фронт) | React 18 + Vite + TypeScript + `@telegram-apps/sdk-react` + Tailwind CSS |
| Бэкенд | NestJS (Node 20+) + TypeScript |
| Entry-бот | grammY |
| Hostinger-клиент | официальный `hostinger-api-sdk` (npm) |
| БД | PostgreSQL + Prisma |
| Очереди/воркеры | BullMQ (Redis) |
| SSH-recovery | `ssh2` |
| Секреты | AES-256-GCM |
| Монорепо | npm workspaces: `apps/backend`, `apps/frontend`, `packages/shared` |

## 3. Hostinger API — проверенные факты
**Source:** `openapi.json` v1.2.1 из `github.com/hostinger/api`.
- **Base URL:** `https://developers.hostinger.com`
- **Auth:** `Authorization: Bearer <token>` (токен из hPanel → Profile → API; те же права, что у юзера)
- **`user_data`/cloud-init: НЕТ.** Вместо него — **post-install scripts**.

### Ключевые эндпоинты (используем в провижининге)
| Метод + путь | Назначение |
|---|---|
| `GET /api/billing/v1/catalog` | каталог тарифов (возвращает массив, `category` фильтр=`VPS` по полю объекта, не query) |
| `GET /api/billing/v1/payment-methods` | способы оплаты аккаунта |
| `GET /api/vps/v1/templates` | список шаблонов ОС/app |
| `GET /api/vps/v1/data-centers` | список дата-центров |
| `POST /api/vps/v1/post-install-scripts` | создать post-install script |
| `GET/PUT/DELETE /api/vps/v1/post-install-scripts/{id}` | управлять скриптом |
| `POST /api/vps/v1/virtual-machines` | **purchase + setup** новой VM |
| `GET /api/vps/v1/virtual-machines` | список VM |
| `GET /api/vps/v1/virtual-machines/{id}` | детали VM (включая IP) |
| `POST /api/vps/v1/virtual-machines/{id}/setup` | setup купленной VM (если purchase оставил в `initial`) |
| `GET /api/vps/v1/virtual-machines/{id}/actions` | список действий/статусов (поллим до installed) |
| `POST /api/vps/v1/virtual-machines/{id}/recreate` | переустановка (принимает `template_id`, `post_install_script_id`) |
| `DELETE /api/vps/v1/virtual-machines/{id}` | удалить VM |
| `POST /api/vps/v1/virtual-machines/{id}/root-password` | сменить root-пароль (для SSH-recovery) |
| `POST /api/vps/v1/public-keys/attach/{vmId}` | прикрепить SSH-ключ (recovery) |

### Post-install script (КЛЮЧ механики)
`POST /api/vps/v1/post-install-scripts`, body = `VPS.V1.PostInstallScript.StoreRequest` (`name`, `content`).
Из описания: *script contents saved to `/post_install` with executable bit, executed once after VM install, output → `/post_install.log`, max 48KB.*
- Скрипт сохраняется в **аккаунте Hostinger** (виден всем, у кого есть токен аккаунта) → **секреты в скрипт класть НЕЛЬЗЯ**. См. §6 (bootstrap pull).
- После установки VM скрипт нужно удалить (`DELETE /post-install-scripts/{id}`) — гигиена.

### `POST /api/vps/v1/virtual-machines` (purchase)
Body = `VPS.V1.VirtualMachine.PurchaseRequest`:
```
{
  "item_id": "hostingercom-vps-kvm1-usd-1m",   // тариф из каталога
  "payment_method_id": 1234,                    // опционально, дефолтный если не указан
  "setup": {                                    // VPS.V1.VirtualMachine.SetupRequest
    "template_id": 1121,                        // ОБЯЗАТЕЛЬНО
    "data_center_id": 11,                       // ОБЯЗАТЕЛЬНО
    "post_install_script_id": 6324,             // наш скрипт
    "password": "...",                          // опц., иначе случайный (не возвращается)
    "hostname": "...",                          // опц.
    "public_key": { "name": "...", "key": "ssh-..." },  // опц., для SSH-recovery
    "install_monarx": false,
    "enable_backups": true
  }
}
```
`item_id` — это **price item id** из `prices[]` элемента каталога (не `id` тарифа). Пример: тариф `hostingercom-vps-kvm1` имеет `prices[]` с `id: "hostingercom-vps-kvm1-usd-1m"` (monthly), `...-usd-1y` (yearly).
**Purchase списывает реальные деньги с аккаунта оператора.**

## 4. Решённые IDs (из живых запросов к API)
| Что | Значение | Примечание |
|---|---|---|
| Template | `1121` | Ubuntu 24.04 with Docker (Docker предустановлен) |
| Data center | `11` | Vilnius, Lithuania (`lt`) — ближайший к РФ. Fallback: `19` Frankfurt (`de`) |
| Тариф | KVM 1 (`hostingercom-vps-kvm1`) | 1 vCPU, 4096 MB RAM, 50 GB NVMe, 300 Mbps |
| item_id (monthly) | `hostingercom-vps-kvm1-usd-1m` | renewal $19.49/мес; first-month промо $9.99 |
| item_id (yearly) | `hostingercom-vps-kvm1-usd-1y` | $155.88/год = $12.99/мес эфф. |

Готового Hermes-template в API **нет**. Другие полезные шаблоны (на будущее): `1007` Ubuntu 22.04, `1077` Ubuntu 24.04 LTS, `1210` Ubuntu 24.04 with Docker and Traefik.

## 5. Hermes Agent — настройка (docker)
**Source:** `/nousresearch/hermes-agent` (Context7, репутация High).
- **Образ:** `nousresearch/hermes-agent:latest`
- **Команда:** `gateway run`
- **Порты:** `8642` (gateway API), `9119` (dashboard, только при `HERMES_DASHBOARD=1`)
- **Volume:** `~/.hermes:/opt/data` (конфиг и данные персистятся на хосте)
- **Базовый docker-compose** (из доков):
```yaml
services:
  hermes:
    image: nousresearch/hermes-agent:latest
    restart: unless-stopped
    command: gateway run
    ports: ["8642:8642", "9119:9119"]
    volumes: ["~/.hermes:/opt/data"]
    environment:
      - HERMES_DASHBOARD=1
    deploy:
      resources:
        limits: { memory: 4G, cpus: "2.0" }   # ← ВНИМАНИЕ: на KVM 1 (4GB) снизить до ~3G
```
⚠️ **Тюнинг под KVM 1 (4GB):** в генерируемом compose снизить `memory` лимит до ~`3G` (оставить голову под OS + Docker daemon ~1GB). Иначе OOM-killer.

### Конфиг Telegram (пишем в `~/.hermes/.env`)
```
TELEGRAM_BOT_TOKEN=<от клиента>
TELEGRAM_ALLOWED_USERS=<telegram_id клиента, через запятую>
<GROQ|GEMINI|OPENROUTER|...>_API_KEY=<LLM-ключ клиента>
HERMES_DASHBOARD=1
```

### Конфиг LLM-провайдера (пишем в `~/.hermes/config.yaml`)
```yaml
custom_providers:
  - name: <provider>          # groq | gemini | openrouter | together | custom
    base_url: <base_url>       # из §7
    key_env: <KEY_ENV>         # имя env-переменной с ключом
model:
  default: <default_model>
  provider: custom:<provider>
```
Hermes поддерживает несколько `custom_providers` одновременно + `fallback_providers`.

## 6. Безопасность: доставка секретов (КРИТИЧНО)
**Проблема:** post-install script хранится в аккаунте Hostinger (виден любому с токеном аккаунта). Класть туда bot token / LLM-ключ нельзя.
**Решение — bootstrap pull:**
1. При создании деплоя бэкенд генерирует **одноразовый bootstrap-токен** (рандомный), в БД хранится только `hash`.
2. Post-install script идёт **без секретов** — содержит только: `curl <BACKEND_URL>/bootstrap/<deploy_id>?token=<one-time>`.
3. VPS после установки дёргает этот URL. Бэкенд проверяет: токен валиден (hash) + не использован + **IP звонящего = IP VM** (из `GET /virtual-machines/{id}`).
4. При успехе бэкенд отдаёт `{ bot_token, llm_provider, llm_key, config_yaml }` (расшифрованные), **инвалидирует токен**.
5. Скрипт пишет `~/.hermes/.env` + `config.yaml` + `docker-compose.yml`, делает `docker compose up -d`, затем `POST <BACKEND_URL>/webhooks/deploy-ready` (подписан одноразовым секретом из того же bootstrap-пэйлоада).
- Replay-защита: токен горит после 1-го использования.
- Fallback если IP-проверка ломается (NAT/IPv6): подписанный one-time JWT вместо IP-проверки (отложить до реального теста — см. риски в плане).

## 7. Каталог LLM-провайдеров (проверенные base_url)
**Source:** `/nousresearch/hermes-agent` (providers.md, google-gemini guide) + `/openclaw/openclaw` (openrouter.md). Все OpenAI-compatible.
| id | name | base_url | key_env | default_model |
|---|---|---|---|---|
| `groq` | Groq (бесплатно) | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `gemini` | Google Gemini (free tier) | `https://generativelanguage.googleapis.com/v1beta/openai/` | `GEMINI_API_KEY` | `gemini-1.5-flash` |
| `openrouter` | OpenRouter (есть free models) | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | (выбор клиента) |
| `together` | Together AI | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` | `meta-llama/Llama-3.1-70B-Instruct-Turbo` |
| `custom` | Свой (OpenAI-compatible) | (ввод клиента) | `CUSTOM_API_KEY` | (ввод клиента) |

Mini App даёт меню выбора; бэкенд подставляет правильный `base_url` + `key_env` в `config.yaml`.

## 8. Модель данных (Prisma)
```
User(telegram_id PK, username, created_at)
Deploy(
  id PK, user_id FK, agent default 'hermes',
  bot_token_enc, bot_username,
  llm_provider, llm_key_enc,
  hostinger_vm_id, hostinger_script_id,
  status enum(pending, creating, configuring, ready, failed, deleted),
  bootstrap_token_hash, bootstrap_used_at, vm_ip,
  paid_until, created_at, updated_at
)
ProvisioningLog(id PK, deploy_id FK, step, status, message, ts)
Subscription/Payment — phase 2 (billing)
```
Секреты (`bot_token_enc`, `llm_key_enc`) — AES-256-GCM шифртекст. `bootstrap_token_hash` — hash одноразового токена (не сам токен).

## 9. API бэкенда
```
POST /auth/validate-init            — TMA initData → { user }   (auth)
GET  /llm-providers                 — каталог провайдеров
POST /validate-bot-token            — прокси к Telegram getMe → { username, id }
POST /deploys                       — создать деплой → 202 { deploy_id }   (auth)
GET  /deploys                       — список деплоев юзера   (auth)
GET  /deploys/:id                   — статус деплоя   (auth)
DELETE /deploys/:id                 — teardown → 202   (auth)
GET  /bootstrap/:deploy_id?token=…  — one-time выдача секретов VPS (IP-проверка)
POST /webhooks/deploy-ready         — от VPS после старта Hermes
```

## 10. Flow деплоя (с реальными эндпоинтами)
1. Mini App: форма → `POST /validate-bot-token` (Telegram getMe) → выбор провайдера + ключ → `POST /deploys`.
2. Бэкенд: шифрует секреты, создаёт `Deploy(pending)` + одноразовый bootstrap-токен (hash в БД), ставит BullMQ-job `deploy`.
3. Воркер `deploy`:
   a. `POST /api/vps/v1/post-install-scripts` — создаёт скрипт (без секретов, с bootstrap-URL + docker-compose генерацией).
   b. `POST /api/vps/v1/virtual-machines` с `setup{template_id:1121, data_center_id:11, post_install_script_id}`.
   c. Поллит `GET /api/vps/v1/virtual-machines/{id}/actions` до installed. Записывает `hostinger_vm_id`, `vm_ip`.
4. На VPS `/post_install` выполняется: `GET /bootstrap/:id?token=…` (тянет секреты, IP-проверка) → пишет `~/.hermes/.env` + `config.yaml` + `docker-compose.yml` (memory limit ~3G) → `docker compose up -d` → `POST /webhooks/deploy-ready`.
5. Бэкенд: инвалид bootstrap-токен, `status=ready`, `DELETE /post-install-scripts/{id}` (гигиена), бот шлёт клиенту «готово, напиши @botusername».
6. Сбой любого шага → `DELETE /virtual-machines/{id}` (если создан) + `DELETE /post-install-scripts/{id}` + `status=failed` + уведомление.

## 11. Teardown flow
`DELETE /deploys/:id` → BullMQ-job `teardown`: `DELETE /api/vps/v1/virtual-machines/{id}` + `DELETE /api/vps/v1/post-install-scripts/{id}` → `status=deleted` + уведомление. Идемпотентно.

## 12. Control-plane
Один микро-VPS оператора: NestJS-бинарник + Postgres + Redis (docker compose). Клиентские VPS — Hostinger, по требованию. `(BACKEND_URL)` должен быть публично доступен (для webhook'ов и bootstrap-pull с клиентских VPS) — HTTPS обязательно.

## 13. Sources
- Hostinger API spec: `openapi.json` v1.2.1, https://github.com/hostinger/api (README → openapi.json; эндпоинты/схемы сверены по строкам: post-install-scripts 4725, virtual-machines purchase 5326, SetupRequest 8424, PurchaseRequest 8333)
- Hermes Agent docs: Context7 `/nousresearch/hermes-agent` (install, docker, telegram.md, providers.md, google-gemini guide)
- OpenClaw docs (cross-check OpenRouter): Context7 `/openclaw/openclaw` (providers/openrouter.md, channels/telegram.md)
- Live API queries (catalog, data-centers, templates) через токен оператора — 2026-07-04

## 14. Phase 1 implementation findings (verified 2026-07-04)
> Дополнения к §2/§3, выявленные при реализации. Sourced, не догадки.

### Prisma 7 (мажорные изменения vs «классического» Prisma 5/6)
- **Driver adapter обязателен.** `new PrismaClient()` без adapter кидает `P2038`. Используем `@prisma/adapter-pg` (`PrismaPg`) с `connectionString = DATABASE_URL`. `pg` и `@types/pg` тянутся transitively через adapter (отдельно ставить не нужно).
- **`url` убран из `datasource` в schema.** Connection URL для Migrate живёт в `prisma.config.ts` (`datasource: { url: env<Env>('DATABASE_URL') }`). Файл `apps/backend/prisma.config.ts` грузит root `.env` (walk-up) — `env()` из `prisma/config` НЕ подгружает `.env` сам.
- **Generator `prisma-client`** (новый), `output = "../src/generated/prisma"` → TS-исходники, импорт `import { PrismaClient } from '../generated/prisma/client'` (нет `index.ts`). Каталог в `.gitignore`. Команды `npx prisma migrate dev` / `npx prisma generate` работают из `apps/backend` (как в AGENTS).
- `@nestjs/config` `validate` бежит при import-eval `ConfigModule.forRoot` (до тела `main.ts`) → root `.env` грузится side-effect импортом `./env` первым в `main.ts`; в forRoot стоит `ignoreEnvFile: true`.

### hostinger-api-sdk@1.2.1 — gap по deleteVM
- SDK **не экспортирует** метод удаления VM (в `VPSVirtualMachineApi` нет `deleteVirtualMachine*`). Все DELETE-методы в SDK — для других ресурсов (payment-methods, post-install-scripts, snapshots, PTR, projects).
- `DELETE /api/vps/v1/virtual-machines/{id}` (§3) существует по openapi.json, но SDK его не генерирует. `ProvisioningService.deleteVM(id)` делает **raw `axios.delete`** на `https://developers.hostinger.com/api/vps/v1/virtual-machines/{id}` с `Authorization: Bearer <token>`.
- **Требует верификации на реальном деплое** (Checkpoint 3): подтвердить, что endpoint отвечает 2xx и VM действительно удаляется. Если нет — альтернатива: отмена подписки (`BillingSubscriptionsApi` имеет только `disableAutoRenewalV1`, без cancel/delete — тоже требует уточнения у Hostinger).

### Прочее
- Purchase-ответ (`BillingV1OrderVirtualMachineOrderResource`) содержит `virtual_machine` напрямую → VM id доступен сразу после purchase (не нужно искать через `listVMs`).
- VM state — поле `state` (enum: running/creating/initial/error/...), у Action — `state` (success/error/delayed/sent/created). «installed» в API нет — воркер (Task 12) должен поллить VM `state`→running и/или actions.
- Версии стека (актуальные на 2026-07-04): Node 22, NestJS 11, TS 6, Vite 8, React 19 (док говорил 18 — SDK `@telegram-apps/sdk-react` поддерживает 19), Tailwind 4 (CSS-first, `@tailwindcss/vite`), Prisma 7, zod 4, grammY 1.44.
- TS 6 депрекейтит `moduleResolution: node` (Node10) → CJS-пакеты (backend, shared) используют `ignoreDeprecations: "6.0"`; frontend — `moduleResolution: bundler`.
- `npm audit`: `@telegram-apps/sdk-react@3.3.9` транзитивно тянет deprecated `@tma.js/*` с уязвимым `valibot` (ReDoS в `EMOJI_REGEX`, GHSA-vqpr-j7v3-hqw9; 9 high). `npm audit fix --force` = breaking downgrade к sdk-react v2. Не блокирует Phase 1 (SDK не используется до Task 5). Переоценить при реализации TMA-auth (Task 5): возможна миграция на `@tma.js/sdk-react` или фикс upstream.

