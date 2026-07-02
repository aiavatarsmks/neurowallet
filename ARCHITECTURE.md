# NeuroWallet — Архитектура

> Актуально на 2026-07-02, после закрытия Фазы 0 (security-блокеры).
> Стратегия зафиксирована: **non-custodial wallet** — все ключи у пользователя,
> сервер не может восстановить кошелёк ни при каких условиях.

## Обзор

NeuroWallet — мультичейн крипто-кошелёк (ETH, BTC, SOL, TRX, TON + USDT в трёх сетях),
работающий как Telegram Mini App (Next.js в WebView Telegram) с AI-ассистентом «Нейра».

```
┌─────────────────────────────────────────────────────────────────┐
│ Браузер / Telegram WebView (клиент)                             │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ДОВЕРЕННАЯ ЗОНА КЛЮЧЕЙ (никогда не покидает браузер)      │  │
│  │  bip39 → деривация 5 чейнов → AES-GCM/keystore →          │  │
│  │  localStorage (только шифроблобы + публичные адреса)      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  UI: onboarding / wallet / send / Neura chat / история          │
└───────────────┬─────────────────────────────────┬───────────────┘
                │ Supabase JWT                    │ подписанные tx
                ▼                                 ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ Next.js API routes (Vercel)   │   │ Публичные RPC/API чейнов      │
│  BFF: auth, rate limit, audit │   │  cloudflare-eth, Solana RPC,  │
│  tg-auth / neura-chat /       │   │  Blockstream, TronGrid,       │
│  tx-history / tg-notify /     │   │  Toncenter (broadcast/balance)│
│  neuro-id / tg-webhook /      │   └───────────────────────────────┘
│  csp-report                   │
└───────┬───────────┬───────────┘
        │           │
        ▼           ▼
┌──────────────┐ ┌──────────────────────────────┐
│ Supabase     │ │ Внешние сервисы (server-only │
│  Auth (JWT)  │ │ ключи): OpenRouter (Нейра),  │
│  Postgres:   │ │ Etherscan, Telegram Bot API  │
│  profiles,   │ └──────────────────────────────┘
│  neuro_dir,  │
│  audit_log   │
└──────────────┘
```

## Границы доверия (инварианты)

1. **Приватные ключи и seed никогда не покидают браузер.** Вся деривация и
   шифрование — client-side (Web Crypto + чистые JS-библиотеки). Ни один
   API-роут не принимает и не возвращает ключевой материал. Подробности —
   `KEY_MANAGEMENT.md`.
2. **AI (Нейра) не имеет доступа к ключам.** В `neura-chat` уходят только
   публичные данные: балансы, публичные адреса, история. Ключей нет ни в
   контексте, ни в промптах.
3. **Server-only секреты** (`OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ETHERSCAN_API_KEY`) живут только в env Vercel
   и никогда не проксируются в ответы (покрыто тестами).
4. **Deny by default**: каждый защищённый endpoint требует Supabase JWT;
   RLS включён на всех пользовательских таблицах; вставка в audit_log —
   только через service role; webhook — fail-closed по секрету.
5. **Граница demo ↔ real**: demo-режим работает на локальных мок-данных
   (`DEMO_TXS` и т.п.) и не выполняет ни одного chain-действия и ни одного
   вызова wallet-API.

## Компоненты

| Компонент | Технологии | Роль |
|---|---|---|
| `frontend/` | Next.js 15 (Pages Router), React 18, Tailwind, three.js | Всё приложение: UI + client-side криптография |
| `frontend/pages/api/*` | Next.js API routes | BFF-слой: auth, rate limit, audit, прокси к внешним API. Спецификация — `API_SPEC.md` |
| Supabase | Auth + Postgres | Идентичность (email-пароль и Telegram initData), RLS-таблицы, append-only audit. Схема — `SUPABASE_SCHEMA.md` |
| `backend/` | Fastify 5 + Prisma | **Вестигиальный**: один мок-роут `GET /api/tx/mock`, не участвует в реальных потоках, ключей не касается. Кандидат на удаление |
| CI | GitHub Actions | 3 джобы: security-audit (блокирует merge при `npm audit ≥ high`), frontend build+test+tsc, backend test |

## Аутентификация

Два пути к одной Supabase-сессии (access token TTL = 900 сек, refresh rotation
включён, reuse interval 10 сек):

1. **Telegram Mini App**: `initData` → `POST /api/tg-auth` → проверка HMAC-SHA256
   подписи ботом + freshness `auth_date` ≤ 15 мин → детерминированные
   креды `tg_<id>@neurowallet.tg` → session. Профиль upsert'ится в `profiles`.
2. **Email + пароль**: стандартный Supabase signIn/signUp (autoconfirm включён).

## Деплой

- **Vercel**, автодеплой из `main` GitHub (`aiavatarsmks/neurowallet`).
  Рабочий URL: `neurowallet-frontend.vercel.app`. Домен `neurovalet.tech`
  (IONOS DNS) — на момент фиксации не резолвится, использовать Vercel-URL.
- CSP отдаётся HTTP-заголовком, `script-src` без `unsafe-inline`; нарушения
  собираются в `/api/csp-report` (см. `frontend/next.config.js`).
- Telegram-бот подключён webhook'ом на `/api/tg-webhook` c обязательным
  `secret_token`.

## Что дальше (укрупнённо, см. IMPLEMENTATION_PLAN.md)

- Фаза 1: trust layer — audit/analytics spine, send review + симуляция,
  risk engine, security center. Rate limiter переезжает на durable store.
- Фаза 2+: layered custody (passkey/MPC), swap/ramp, policy engine для Нейры.
- Перед любыми реальными деньгами — независимый security-аудит (gate Фазы 3).
