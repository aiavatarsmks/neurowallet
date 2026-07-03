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
- Домен **neurowallet.tech** управляется через **IONOS**.
- В IONOS DNS прописаны записи, указывающие на Vercel.
- Telegram Mini App подгружает приложение с домена **neurowallet.tech**.

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

## Блокеры безопасности (Priority 1) — ✅ ЗАКРЫТО

**Статус: все 7 пунктов Фазы 0 закрыты, Gate Фазы 0 пройден** (см. `IMPLEMENTATION_PLAN.md`, раздел «Фаза 0» и его Gate). CI зелёный, 0 vulnerabilities severity ≥ high. Эти блокеры больше не сдерживают дальнейшую работу.

Файлы и номера строк ниже оставлены как **историческая справка** (где был дефект на момент постановки) — не как открытые задачи.

### 1. XOR-схема мультичейн-ключей — системный дефект ✅ ЗАКРЫТО
**Файл (историч.):** `frontend/lib/crypto/transactions.ts:308`
Было: SOL/BTC/TRON/TON ключи восстанавливались через XOR с ETH private key — компрометация ETH-keystore означала компрометацию всех сетей.
**Закрыто:** XOR как способ хранения/восстановления ключей убран; перешли на отдельные encrypted per-chain private keys с единой unlock-схемой (переходный вариант; целевая seed-derived архитектура — в roadmap). Миграция существующих пользователей выполнена.

### 2. Ключи в localStorage ✅ ЗАКРЫТО (минимум для MVP)
**Файл (историч.):** `frontend/lib/crypto/wallet.ts:146`
**Закрыто:**
- scrypt N поднят с 8192 до 131072 (2^17), со старых keystore предусмотрена перешифровка.
- Seed-фраза (мнемоника) — никогда в localStorage ✅
- При unlock ключ расшифровывается в память → используется → переменная обнуляется явно.
**Остаётся на prod (не блокер MVP):** WebCrypto Secure Enclave / MPC-архитектура.

### 3. AI endpoints без защиты ✅ ЗАКРЫТО
**Файлы (историч.):** `frontend/pages/api/neura-chat.ts:55`, `frontend/pages/api/tg-notify.ts:18`
**Закрыто:**
- Проверка Supabase JWT на обоих endpoint (запрос без валидного JWT → 401); `telegramId` берётся из сессии, не из body.
- Rate limit на пользователя (превышение → 429).
- Все вызовы AI логируются в audit_log.

### 4. CSP слабый ✅ ЗАКРЫТО
**Файл (историч.):** `frontend/pages/_app.tsx:26`
**Закрыто:** CSP перенесён из meta-тега в HTTP headers (`next.config.js`), `unsafe-inline` убран где возможно.

### 5. Уязвимые зависимости ✅ ЗАКРЫТО
Было: 11 vulnerabilities (1 critical — Vitest RCE, 7 high — Next.js, Fastify, Vite).
**Закрыто:** зависимости обновлены, 0 vulnerabilities severity ≥ high; CI блокирует merge на severity ≥ high.

### 6. Тесты не работают ✅ ЗАКРЫТО
Было: backend `server.ts:8` (PrismaClient падал при пустой schema), frontend `vitest.config.ts` (не настроен alias `@/`).
**Закрыто:** конфиги починены, тесты запускаются локально и в CI, pipeline зелёный.

### 7. Supabase RLS + сессии ✅ ЗАКРЫТО
**Закрыто:** RLS на всех пользовательских таблицах, `audit_log` append-only (insert только через service role); TTL сессий приведены к норме (access ≤ 15 мин, refresh ≤ 24 ч, инвалидация всех сессий при смене пароля); верификация Telegram `initData` (HMAC + freshness) на backend.

---

## Фаза 1 — Trust Layer — ✅ РЕАЛИЗОВАНА (1.1–1.8)

Полностью реализована (детали и приёмка — в `IMPLEMENTATION_PLAN.md`, «Фаза 1»):

- **1.1 Audit/Analytics spine** — схема доменных событий; каждое критичное действие эмитит событие с **trace id**, связывающим все слои (UI → API → provider → chain tx).
- **1.2 Send review с симуляцией** — предпросмотр отправки с симуляцией комиссий до подписи.
- **1.3 Risk engine + anti-poisoning** — проверка адреса/сети, защита от address-poisoning.
- **1.4 Contacts + NeuroID** — адресная книга и резолв NeuroID.
- **1.5 Paylinks** — платёжные ссылки.
- **1.6 Security center (+ PIN flow)** — центр безопасности с настройкой/сменой PIN.
- **1.7 Neura tx-explainer / recap** — объяснение транзакций и recap; **LLM работает только на validated fields** (никакого прямого доступа к ключам или неверифицированным данным).
- **1.8 Demo-воронка** — demo mode с конверсионной воронкой.

**Статус:** 114 тестов, CI зелёный.

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

## Актуальный roadmap

Актуальный roadmap ведётся в **`IMPLEMENTATION_PLAN.md`**. Читать оба файла вместе: `CLAUDE.md` (инварианты, принципы, «что не делать») + `IMPLEMENTATION_PLAN.md` (фазы, приёмка, порядок работ).

**При конфликте приоритет у инвариантов из `CLAUDE.md`.**

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
