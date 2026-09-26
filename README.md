# NeuroWallet

Некастодиальный мультичейн крипто-кошелёк с AI-ассистентом «Нейра». Работает как
Telegram Mini App и как сайт в браузере на **neurowallet.tech** (деплой — Vercel).

> Статус: рабочий прототип. Реальные деньги — только после независимого
> security-аудита (см. `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`).

## Что умеет

- Сети: **TON, USDT (TON)**, BTC, ETH, USDT (ERC-20), SOL, TRX, USDT (TRC-20) — mainnet.
- Создание / импорт seed-фразы, приём (QR, paylink), отправка с review-симуляцией
  комиссии, risk engine и защитой от address-poisoning, история транзакций.
- Вход: Telegram `initData` (в Mini App) или e-mail/пароль (Supabase) в браузере; demo-режим.
- Нейра: чат и объяснение транзакций только по проверенным публичным данным.
- Policy Engine, claim-ссылки, уведомления, swap/on-ramp — за feature-флагами.

## Модель безопасности (кратко)

- Ключи и seed **никогда не покидают браузер**: деривация и подпись client-side,
  на устройстве хранятся только зашифрованные блобы (AES-GCM / keystore) и публичные адреса.
  Seed-фраза в localStorage не сохраняется.
- Серверные API-роуты принимают только публичные данные и требуют Supabase JWT,
  с rate limit и audit log. RLS включён на всех пользовательских таблицах.
- Подробнее: `ARCHITECTURE.md`, `KEY_MANAGEMENT.md`, `SUPABASE_SCHEMA.md`, `API_SPEC.md`, `SECURITY.md`.

## Структура

```
frontend/            Next.js 15 (pages router) + Tailwind + TypeScript — всё приложение
  pages/             экраны и API-роуты (pages/api/*, серверная часть на Vercel)
  lib/crypto/        деривация, шифрование, подпись и отправка по сетям
  lib/server/        server-only код (auth/rate limit/audit, ключи провайдеров)
  __tests__/         vitest
supabase/migrations/ SQL-миграции (RLS, audit, контакты, уведомления, policies…)
backend/             минимальный Fastify-сервис (legacy, в проде не используется)
```

## Запуск локально

Требуется Node.js 22.

```bash
npm install                      # из корня (npm workspaces)
cd frontend
# создать frontend/.env.local с переменными ниже (минимум — Supabase URL и anon key)
npm run dev                      # http://localhost:3000
```

Проверки (то же, что в CI):

```bash
cd frontend
npm run lint && npx tsc --noEmit && npm test
npm audit --audit-level=high     # CI блокирует merge при high/critical
```

## Переменные окружения (frontend)

Публичные (`NEXT_PUBLIC_*` попадают в клиентский бандл — только не-секреты):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_TELEGRAM_BOT_URL` и флаги `NEXT_PUBLIC_*_ENABLED`.

Серверные секреты (только env Vercel, никогда `NEXT_PUBLIC_`):

| Переменная | Назначение |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | audit log и серверные операции Supabase |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram auth / бот |
| `OPENROUTER_API_KEY` | Нейра |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limit |
| `ETHERSCAN_API_KEY` | история ETH / USDT ERC-20 (без ключа — пусто) |
| `TONCENTER_API_KEY` | балансы TON / USDT-TON и история TON (без ключа — публичный лимит 1 req/s) |
| `TRONGRID_API_KEY` | балансы и история TRX / USDT TRC-20 (без ключа — публичные лимиты) |

Ключи блокчейн-провайдеров читаются в `frontend/lib/server/provider-keys.ts`;
браузер получает балансы TON/TRON через `/api/balances`, а если ключ не задан —
ходит к провайдеру напрямую, как раньше.

## Документы

- `CLAUDE.md` — инварианты и принципы (приоритет при конфликте)
- `IMPLEMENTATION_PLAN.md` — фазы и приёмка
- `DECISION_*.md` — принятые / ожидающие решения
