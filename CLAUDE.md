# CLAUDE.md — NeuroWallet Project Context

> Этот файл читается при каждом запуске Claude Code. Следуй этим инструкциям строго.

---

## Продукт и видение

**NeuroWallet** — AI-powered crypto wallet, в перспективе AI-необанк.
Главный дифференциатор: **Нейра** — анимированный AI-ассистент, который помогает управлять финансами и даёт советы.
Стратегия: сначала crypto (меньше регуляторики), затем fiat/neobank.

**Текущий статус:** MVP — рабочий демо-прототип. До prod с реальными деньгами не допускать.

---

## Репозиторий

```
/Users/maksimilin/Desktop/NeuroWallet/MVP/Старое/Разработка и код/repo
├── frontend/          # Next.js + Tailwind + TypeScript + Telegram Mini App
├── backend/           # Fastify + Prisma + PostgreSQL
├── docker-compose.yml # PostgreSQL + pgAdmin
```

Что реализовано:
- Auth через Supabase + Telegram initData
- Генерация/import seed phrase
- Мультичейн: ETH, BTC, SOL, USDT ERC-20, USDT TRC-20, TON, USDT TON
- Балансы через публичные RPC/API
- Отправка транзакций client-side
- Нейра: 3D-аватар + AI-chat через OpenRouter proxy
- Receive/send screens, profile, история транзакций

---

## Деплой и домен

Текущее решение:
- Основной деплой перенесён с Netlify на **Vercel**.
- Домен **neurovalet.tech** управляется через **IONOS**.
- В IONOS DNS прописаны записи, указывающие на Vercel.
- Telegram Mini App подгружает приложение с домена **neurovalet.tech**.

Контекст: ранее часть обновлений не проявлялась из-за старой привязки/deploy-контура Netlify. При проверке production-поведения сначала смотреть Vercel deployment и DNS IONOS, а не Netlify.

---

## Приоритеты работы

### ПРИНЦИП №1 — Бизнес-стратегия определяет архитектуру

Перед любой архитектурной работой убедись, что понята бизнес-модель:

- **Non-custodial wallet** (текущий путь) — ключи у пользователя, меньше регуляторики, но 100% ответственность на пользователе. Вся key management — client-side.
- **Custodial fintech** — лицензия, KYC/AML, капитал. Ключи на сервере/HSM.
- **B2B AI money ops** — другой рынок, другая архитектура.

Текущий код смешивает все три подхода. **Не добавлять новый функционал, пока эта стратегия не выбрана явно.**
Если неясно — спроси Максима прежде чем писать код.

---

### ПРИНЦИП №2 — Не добавлять "красивые экраны"

Приоритет: **доверенный слой** (ключи, подпись, policy engine, audit, tests, monitoring, compliance).
Не реализовывать UI/UX фичи пока не закрыты блокеры безопасности Priority 1.

---

## Блокеры безопасности (Priority 1 — СЕЙЧАС)

Эти пункты блокируют любую работу с реальными деньгами:

### 1. XOR-схема мультичейн-ключей — системный дефект
**Файл:** `frontend/lib/crypto/transactions.ts:308`
SOL/BTC/TRON/TON ключи восстанавливаются через XOR с ETH private key.
Если скомпрометирован ETH-keystore — скомпрометированы все сети одновременно.
**Требуется:** убрать XOR как способ хранения/восстановления ключей. Для non-custodial web допускается только временный переходный вариант с отдельными encrypted per-chain private keys и единой unlock-схемой; целевая архитектура — seed-derived keys через корректные BIP-44/SLIP paths, защищённые полноценным key management (WebCrypto/Secure Enclave/MPC в зависимости от выбранной стратегии).
**Внимание:** требуется миграция существующих пользователей.

### 2. Ключи в localStorage — неприемлемо для prod
**Файл:** `frontend/lib/crypto/wallet.ts:146`
Keystore + XOR-blob в localStorage доступны через XSS, расширения браузера, devtools.
**Требуется (минимум для MVP):**
- scrypt N увеличить с 8192 до 131072 (2^17)
- Seed-фраза (мнемоника) — никогда в localStorage ✅ уже выполнено
- При unlock: расшифровать в память → использовать → обнулить переменную
- Переменную с ключом обнулять явно (V8 GC не гарантирует немедленную очистку)
**Требуется (для prod):** WebCrypto Secure Enclave или MPC-архитектура

### 3. AI endpoints без защиты
**Файл:** `frontend/pages/api/neura-chat.ts:55`
`/api/neura-chat` — нет проверки Supabase-сессии, нет rate limit → риск billing drain.

**Файл:** `frontend/pages/api/tg-notify.ts:18`
`/api/tg-notify` принимает произвольный `telegramId` и `message` без auth → abuse.

**Требуется:**
- Добавить проверку Supabase JWT на оба endpoint
- Rate limit: max N запросов/минуту на пользователя
- Логировать все вызовы AI в audit_log

### 4. CSP слабый
**Файл:** `frontend/pages/_app.tsx:26`
CSP задан meta-тегом с `unsafe-inline`.
**Требуется:** CSP через HTTP header (next.config.js) с nonce/hash, убрать `unsafe-inline` где возможно.

### 5. Уязвимые зависимости
`npm audit` — 11 vulnerabilities: 1 critical (Vitest RCE), 7 high (Next.js, Fastify, Vite).
**Требуется:** обновить Next.js, Fastify, Vitest. Настроить CI блокировку на severity ≥ high.

### 6. Тесты не работают
- Backend: `server.ts:8` — PrismaClient падает при пустой schema
- Frontend: `vitest.config.ts` — не настроен alias `@/`
**Требуется:** починить конфиги, запустить CI зелёным.

---

## Нейра — Policy Engine (Priority 2, но концептуально важен)

Нейра — не просто чат. Это core дифференциатор продукта.
Цель: **policy-driven agent**, но БЕЗ права самостоятельно тратить деньги.

Архитектура Нейры должна включать:

```
Policy Engine       — лимиты, разрешения, trusted recipients, auto-block rules
Action Proposals    — Нейра готовит действие, пользователь подтверждает
Tool Firewall       — AI не имеет прямого доступа к private keys (никогда)
Explainability      — почему Нейра предлагает действие
Audit Log           — что предложила, что пользователь принял/отклонил
Risk Layer          — проверка адреса, сети, комиссии, контракта
Simulation          — показать итог ДО подписи
```

**Важно:** Policy Engine — это не просто feature, это единственное, что отличает NeuroWallet от "красивого crypto wallet с чатом". Реализовывать его надо раньше, чем новые UI-экраны.

---

## Supabase — обязательная конфигурация

```sql
-- RLS обязателен для ВСЕХ пользовательских таблиц
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Пользователь видит только своё
CREATE POLICY "transactions_select_own" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Клиент не делает INSERT напрямую — только через Edge Functions
CREATE POLICY "transactions_insert_via_function" ON transactions
  FOR INSERT WITH CHECK (false);

-- Audit log — вставка только через service role
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users,
  action TEXT NOT NULL,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
```

**Service Role Key — НИКОГДА в клиентском коде.** Только в Edge Functions / backend.
**anon key** — публичный, не секрет, но жёстко ограничен RLS.

Сессии:
- Access token TTL ≤ 15 минут
- Refresh token TTL ≤ 24 часа (сейчас 30 дней — слишком долго)
- При смене пароля — инвалидировать ВСЕ сессии

---

## Дизайн-система

- Background: `#0A0A0A` (near-black)
- Accent: neon green `#00FF7F` area + purple/blue gradient для логотипа
- Нейра: 3D-аватар, wireframe neural mesh или реалистичная female avatar
- Bottom tab navigation: Home, History/Send, Cards, Receive
- Баланс — prominently, история транзакций с иконками

---

## Документация к написанию

Не писать doc-файлы ради галочки. Писать только когда соответствующая часть кода стабилизирована:

| Файл | Когда писать |
|------|-------------|
| `ARCHITECTURE.md` | После выбора бизнес-стратегии (non-custodial vs custodial) |
| `KEY_MANAGEMENT.md` | После переработки key management |
| `AI_AGENT_POLICY.md` | После реализации Policy Engine |
| `SUPABASE_SCHEMA.md` | После настройки RLS и миграций |
| `API_SPEC.md` | После защиты AI endpoints |
| `COMPLIANCE.md` | Перед фиат/neobank расширением |
| `RUNBOOK.md` | Перед первым prod-деплоем |

---

## Рекомендованный порядок работы

1. **Выбрать и зафиксировать бизнес-стратегию** (non-custodial / custodial / B2B). Это определяет key management, compliance, backend, AI-полномочия и roadmap.
2. **Остановить real-money rollout.** Только demo/test funds.
3. **Починить тесты и CI.** npm audit fix, зелёный pipeline.
4. **Защитить AI endpoints.** Auth + rate limit + audit log.
5. **Исправить scrypt N** с 8192 до 131072.
6. **Переработать мультичейн key management.** Убрать XOR, определить временный encrypted per-chain вариант и целевую архитектуру.
7. **Включить RLS** на все таблицы Supabase.
8. **Реализовать transaction confirmation layer.** Simulation, адрес, сеть, комиссия, риск.
9. **Начать Policy Engine для Нейры.**
10. **Независимый security audit / pentest** перед публичным запуском.

---

## Что не делать

- Не добавлять новые UI-экраны пока не закрыт хотя бы Priority 1
- Не хранить service role key в клиентском коде
- Не давать Нейре прямой доступ к private keys (никогда, ни при каком условии)
- Не делать INSERT транзакций напрямую с клиента
- Не мерджить код с npm audit severity ≥ high
- Не смешивать архитектурные модели (non-custodial + custodial одновременно)

---

## Ссылки

- [OWASP MASVS](https://mas.owasp.org/MASVS/)
- [Telegram Mini Apps init data validation](https://docs.telegram-mini-apps.com/platform/init-data)
- [EIP-4337 Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- [WalletConnect docs](https://docs.walletconnect.network/)
- [SECURITY_ARCHITECTURE.md](/Users/maksimilin/Desktop/NeuroWallet/SECURITY_ARCHITECTURE.md)
