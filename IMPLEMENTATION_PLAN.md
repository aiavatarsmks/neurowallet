# NeuroWallet — Master Implementation Plan

> План внедрения по итогам глубинного исследования рынка (июль 2026).
> Предназначен для исполнения через Claude Code, фаза за фазой.
> Читается вместе с `CLAUDE.md` — его правила (безопасность прежде фич, AI никогда не касается ключей) имеют приоритет над любым пунктом этого плана.

---

## Как работать с этим планом (инструкция для Claude Code)

1. Выполнять фазы строго по порядку. **Фаза N+1 не начинается, пока не закрыты acceptance criteria фазы N.**
2. Каждый пункт фазы — самостоятельная задача: у неё есть scope, файлы/сервисы, критерии приёмки. Брать по одной, доводить до зелёных тестов, коммитить.
3. Перед любой задачей перечитать раздел «Инварианты» ниже. Если задача конфликтует с инвариантом — остановиться и спросить Максима.
4. Каждая фича добавляется вместе с: тестами, событиями в audit_log, метриками, feature flag. Без этого задача не считается закрытой.
5. Region/provider-зависимые вещи (ramps, карты, KYC) — только через capability flags, никаких hardcoded-предположений.

---

## Стратегическая рамка (из исследования)

Рынок-2026 выигрывают не «кошельки с максимумом чейнов», а продукты, которые делают три вещи одновременно:

1. **Резко снижают когнитивную нагрузку** (contact-first платежи, demo-режим, seedless вход).
2. **Предотвращают необратимые ошибки** (simulation, risk scoring, explain-before-sign, anti-poisoning).
3. **Зарабатывают на реальных полезных действиях** (swap/ramp revshare, premium AI+safety, позже карты).

Позиционирование NeuroWallet: **не «MetaMask в Telegram», а Revolut-образный money cockpit поверх self-custody wallet**. Связка из шести элементов, дающая wow + retention + доход:

1. Идеальный Telegram-first onboarding (demo → real за 60 секунд)
2. Contact-based send/receive (NeuroID / Telegram username / ENS / QR / paylink)
3. AI explain-before-sign (Нейра объясняет транзакцию до подписи)
4. Recipient/address risk engine (shield-UX)
5. Fiat rails / stablecoin spending (позже, partner-driven)
6. Premium safety layer (монетизация доверия)

---

## Инварианты (нарушать нельзя ни в одной фазе)

- **AI (Нейра) никогда не имеет доступа к приватным ключам, seed, key shares.** Только structured intents → deterministic tools → policy check → user confirmation → signer.
- **Любое денежное действие = deterministic tool + policy evaluation + явное подтверждение пользователя.** Никакого freeform-исполнения из LLM-текста.
- **Deny by default** в policy engine. Immutable (append-only) audit log для всех критичных действий.
- **Никаких real-money операций** до закрытия Фазы 0 и независимого security-аудита. Только demo/test funds.
- **Seed/private key никогда не попадает на backend.** Server не должен уметь единолично восстановить кошелёк пользователя.
- **Service role key — никогда в клиентском коде.** RLS на всех пользовательских таблицах.
- **Собственный токен не выпускаем** (regulatory + trust риск, не даёт PMF).
- Fiat/cards/custodial-функции проектируются как **partner-driven regulated surfaces**, не «запустим — потом оформим».
- Жёсткая граница demo ↔ real: из demo-режима невозможно ни одно реальное chain-действие.

---

## Фаза 0 — Security-блокеры (СЕЙЧАС, ~1–2 недели)

Это Priority 1 из CLAUDE.md. Блокирует всё остальное. Исследование подтверждает: без видимого security-слоя продукт с AI внутри воспринимается как *более* рискованный, а не более удобный.

### 0.1 Починить тесты и CI
- Backend: `server.ts:8` — PrismaClient падает при пустой schema.
- Frontend: `vitest.config.ts` — настроить alias `@/`.
- CI: блокировка merge при `npm audit` severity ≥ high.
- **Приёмка:** pipeline зелёный, тесты запускаются локально и в CI.

### 0.2 Обновить уязвимые зависимости
- `npm audit`: 1 critical (Vitest RCE), 7 high (Next.js, Fastify, Vite). Обновить Next.js, Fastify, Vitest.
- **Приёмка:** 0 vulnerabilities severity ≥ high.

### 0.3 Защитить AI endpoints
- `frontend/pages/api/neura-chat.ts:55` — добавить проверку Supabase JWT, rate limit (N req/мин на пользователя), логирование в audit_log.
- `frontend/pages/api/tg-notify.ts:18` — auth обязателен, `telegramId` брать из сессии, не из body.
- **Приёмка:** запрос без валидного JWT → 401; превышение лимита → 429; каждый вызов AI виден в audit_log.

### 0.4 Ключи и localStorage
- `frontend/lib/crypto/wallet.ts:146`: scrypt N: 8192 → 131072 (2^17), с миграцией существующих keystore.
- Unlock: расшифровка в память → использование → явное обнуление переменной.
- **Приёмка:** новый keystore создаётся с N=131072; старые перешифровываются при первом unlock; ключ не живёт в переменной дольше операции подписи.

### 0.5 Убрать XOR-схему мультичейн-ключей
- `frontend/lib/crypto/transactions.ts:308`: SOL/BTC/TRON/TON через XOR с ETH-ключом — системный дефект (компрометация ETH = компрометация всего).
- Переходный вариант: отдельные encrypted per-chain private keys + единая unlock-схема. Целевая архитектура: seed-derived keys через BIP-44/SLIP-0010 paths (см. Фазу 2 — layered custody).
- Обязательна миграция существующих пользователей.
- **Приёмка:** XOR-код удалён; derived-адреса совпадают с test vectors; миграция проходит на тестовых кошельках без потери доступа.

### 0.6 CSP через HTTP headers
- `frontend/pages/_app.tsx:26` → перенести в `next.config.js` headers, nonce/hash, убрать `unsafe-inline` где возможно.
- **Приёмка:** CSP приходит header'ом, отчёты о нарушениях собираются (report-uri/Sentry).

### 0.7 Supabase RLS + сессии
- RLS на всех пользовательских таблицах (шаблоны политик — в CLAUDE.md). Таблица `audit_log` (append-only, insert только через service role).
- Access token TTL ≤ 15 мин, refresh ≤ 24 ч, инвалидация всех сессий при смене пароля.
- Верификация Telegram `initData` (HMAC, freshness `auth_date`) на backend для каждой сессии Mini App.
- **Приёмка:** пользователь A не читает данные пользователя B ни одним запросом; invalid/stale initData → отказ; сессия создаётся < 500 мс.

**Gate фазы 0:** зелёный CI, 0 high/critical vulnerabilities, все 7 пунктов приняты. Только после этого — новые фичи.

---

## Фаза 1 — Trust Layer (~2 недели после Фазы 0)

Цель: сделать безопасность *видимой* и закрыть главные пробелы против лидеров рынка. Никаких лицензируемых функций. Это фичи «Now / 2 weeks» из исследования.

### 1.1 Analytics + Audit spine (делать первым — на него опирается всё)
- Схема доменных событий; каждое ключевое действие эмитит событие с trace id (UI → API → provider → chain tx).
- Таблицы: `audit_logs` (append-only), `analytics_events`.
- Follow-up из 0.3: rate limiter в `frontend/lib/server/api-security.ts` — in-memory, на Vercel состояние per-instance (реальный потолок = инстансы × лимит). Перевести на durable store (Upstash Redis / Vercel KV), общий для всех serverless-инстансов.
- Метрики-минимум: wallet creation conversion, first successful send, warning override rate, AI usage.
- **Приёмка:** у каждого критичного действия есть trace id, связывающий все слои.

### 1.2 Send review flow с симуляцией
- Flow: recipient/amount → simulate → review card (сумма, комиссия, balance delta, warnings) → confirm.
- Проверки: checksum, chain/token match, balance sufficiency; simulation через RPC (MVP — native transfers).
- Таблицы: `tx_drafts`, `simulation_results`.
- **Приёмка:** ≥95% переводов показывают preview; high-risk mismatch блокирует отправку; simulation timeout → явное предупреждение, не тихий пропуск.

### 1.3 Recipient risk scoring + address poisoning defense
- Risk engine как отдельный модуль (не фича внутри send): score unknown/warning/block, объяснимые причины в UI (зелёный/жёлтый/красный shield).
- MVP-эвристики: first-seen address banner, similarity check (prefix/suffix, Levenshtein) против истории и контактов, базовые phishing/sanctions списки. Vendor intel (Blockaid/TRM-класс) — Фаза 2.
- Override рискованной отправки — только через step-up auth, полностью в audit_log.
- Таблицы: `risk_events`, `recipient_profiles`, `poisoning_alerts`, `override_actions`.
- **Приёмка:** тестовый набор poisoning-паттернов флагается; каждый override залогирован.

### 1.4 Address book + NeuroID alias resolver
- Recipient picker: контакты / NeuroID / вставленный адрес в одном селекторе; favorites; recent recipients.
- Alias service: claim/resolve NeuroID, anti-collision, privacy settings. ENS/TON usernames — Фаза 2.
- Таблицы: `contacts`, `alias_claims`, `favorites`, `recipient_history`.
- **Приёмка:** резолв детерминирован; коллизии невозможны; отправка «человеку» работает end-to-end.

### 1.5 QR + paylinks + request money
- Receive: QR с amount/token/network (опционально); shareable подписанные ссылки с expiry; Telegram share sheet.
- Таблицы: `payment_requests`, `payment_events`.
- **Приёмка:** ссылка резолвится в точный запрос, истекает корректно, статус обновляется.

### 1.6 Security center (lite)
- Экран: biometrics/PIN статус, активные сессии/устройства, история экспорта ключей, последние risk events, revoke сессии.
- Step-up auth (биометрия/PIN) перед: экспортом seed, override risk warning, сменой recovery.
- Таблицы: `devices`, `device_sessions`, `security_events`.
- **Приёмка:** revoke работает сразу; security feed отражает события near real-time.

### 1.7 Нейра: transaction explainer + portfolio recap (structured AI v1)
- Explainer: deterministic decode транзакции → факты → LLM только оформляет объяснение на простом русском. Неизвестные значения помечаются «unknown», никакой генерации поверх невалидированного calldata.
- Portfolio recap: «что изменилось за 24ч/неделю» из snapshot-данных.
- UI: structured cards, а не свободный чат; кнопка «спросить подробнее».
- Все prompts/tool calls/результаты — в audit_log (hash).
- **Приёмка:** объяснение строится только из validated decoded fields; explainer доступен из истории и из send review.

### 1.8 Demo mode с конверсионной воронкой
- Guided demo: 3 задачи от Нейры (посмотреть портфель, получить paylink, «отправить» демо-транзакцию с review) → CTA создать real wallet.
- Жёсткая граница demo/real; conversion events в аналитику.
- Живая Нейра в демо через публичный `/api/neura-demo` (без JWT, т.к. у демо нет сессии): без walletContext, demo-промпт, per-IP rate limit + глобальный дневной бюджет (`NEURA_DEMO_DAILY_MAX`). Достаточно для этапа friends-testers.
- **⚠️ Перед публичным запуском (не friends-testers):** пересмотреть защиту `/api/neura-demo` жёстче — per-IP лимит обходится ротацией IP. Добавить бот-защиту (Turnstile/hCaptcha перед первым demo-запросом к AI), ужесточить дневной бюджет, рассмотреть device/session-токен для demo вместо чистого per-IP. Дневной бюджет — потолок расходов, но не защита от abuse-трафика/скрейпинга.
- **Приёмка:** из demo невозможно chain-действие; conversion event срабатывает после задач.

**Gate фазы 1:** первый прогон юзабилити на 5–10 пользователях; метрики онбординга и send-flow собираются.

---

## Фаза 2 — MVP+ (~1 месяц)

Цель: снизить фрикшен входа, включить первые revenue lines, retention-механики.

### 2.1 Layered custody: passkey + embedded seedless (beta)
- **[Interim, до MPC] Durable key storage — уйти с localStorage на Telegram CloudStorage для `wallet_*_enc` / `wallet_keystore` / `wallet_pin_blob`.**
  Причина: в Telegram WebView localStorage может вытесняться между полными перезапусками приложения — наблюдался симптом «PIN Не настроен» + «неверный пароль» при уцелевшем `wallet_eth_address` (пропали `pin_blob` и enc-блобы). Пока ключи хранятся в localStorage, кошелёк на устройстве периодически становится нерабочим.
  **Оценка: ~2.5–3.5 дня** (не ≤1 дня — сознательно откладываем из немедленного фикса; на стабильность сначала просто последим в обычном использовании).
  **Дизайн:** CloudStorage — источник истины, localStorage — синхронный кэш. Hydration на старте (async-загрузка всех `wallet_*` в кэш, рендер за fail-closed 'checking'); write-through на ~6–8 write-site'ах (`saveWalletToStorage`, 10 setItem в onboarding, `setupPin`/`clearPin`/`clearWalletFromStorage`) — 67 синхронных read-site'ов НЕ трогаем; двусторонняя миграция (upload пока localStorage жив / restore если вытеснен). Вне Telegram (браузерный e-mail путь) остаётся localStorage.
  **Риски:** (1) атомарность 11 ключей без транзакции — частичная запись + последующее вытеснение localStorage = потеря ключей → писать keystore/enc первыми, verify readback перед пометкой «migrated», localStorage как fallback до подтверждения; (2) зашифрованные блобы уходят на серверы Telegram — остаётся non-custodial (AES-GCM+PBKDF2, Telegram не расшифрует), но это смена threat-model, согласовать как продуктовое решение; (3) async-гонка — все read-пути обязаны уважать hydration-ready (fail-closed гейт уже задаёт паттерн); (4) лимиты CloudStorage — 4096 символов/значение и 1024 ключа: наши блобы (~100 символов enc/pin, keystore ~600–800) и ~11 ключей проходят с запасом; (5) Telegram <6.9 без CloudStorage → degrade на localStorage.
  **Снимается полностью** при переходе на embedded MPC ниже — тогда локальное хранилище перестаёт быть источником истины для ключей.
- Default retail path: embedded MPC wallet (провайдер класса Coinbase Embedded / Dynamic / Web3Auth — выбрать по TON+Tron+Solana покрытию, custody-модели, цене; свести в сравнительную таблицу перед интеграцией и согласовать с Максимом).
- Advanced path: текущий import/create seed (усиленный в Фазе 0), позже hardware.
- Passkey (WebAuthn) как backup/step-up фактор. Учесть ограничения Telegram WebView → fallback в external browser tab.
- Recovery center: понятный экран «как я восстановлю доступ».
- **Приёмка:** кошелёк создаётся без seed-фразы < 60 сек; recovery подтверждён; raw key нигде не экспонируется.

### 2.2 Swap v1 (первый revenue line)
- Один swap-роутер (1inch/LI.FI класс) через provider allowlist; quote → route details → slippage caps → simulation → sign.
- Прозрачный fee breakdown (наша маржа видна пользователю).
- Таблицы: `quotes`, `executions`, `fee_breakdown`.
- **Приёмка:** unified quote schema; комиссия раскрыта до подтверждения; slippage cap применяется.

### 2.3 On-ramp v1 (второй revenue line)
- Один провайдер (MoonPay/Transak/Ramp класс), hosted flow; region capability flags; webhook reconciliation.
- Таблицы: `ramp_orders`, `provider_sessions`, `kyc_statuses`.
- **Приёмка:** order state durable/idempotent через webhooks; неподдерживаемый регион — честный отказ до KYC.

### 2.4 Notification engine v1
- Event bus → rule engine → каналы: Telegram + in-app inbox. События: tx confirmed/failed, первый receive от нового отправителя, security alerts, price alerts.
- Preference center, quiet hours, дедупликация, rate limiting; никакой чувствительной информации в текстах уведомлений.
- Таблицы: `notification_rules`, `deliveries`.
- **Приёмка:** настройки пользователя соблюдаются; дубликаты не доставляются.

### 2.5 Portfolio home v2
- Hero: net worth + change + key movers; asset registry + verified token lists, spam filtering по умолчанию; sparkline history.
- Multi-provider data: отдельные провайдеры для RPC, цен, risk intel — не строить всё на одном API.
- Таблицы: `asset_registry`, `verified_tokens`, `balance_snapshots`, `price_ticks`.
- **Приёмка:** home < 1.5 сек из кэша; spam-токены скрыты по умолчанию.

### 2.6 Contact discovery + ENS/TON resolvers
- Telegram contacts linking (privacy-first, opt-in), ENS/TON username резолв в recipient picker.
- **Приёмка:** «отправить по @username» работает; privacy-настройки уважаются.

### 2.7 Weekly AI recap v1
- Нейра-дайджест «что произошло с деньгами за неделю» из snapshot/событий → карточка в inbox + Telegram.
- **Приёмка:** recap собирается только из фактических данных; open rate трекается.

**Gate фазы 2:** первые revenue-события (swap/ramp), D7 retention измерим, funnel онбординга инструментирован.

---

## Фаза 3 — Production (~3 месяца)

Цель: policy-guarded AI actions (ядро дифференциации), глубина портфеля, premium.

### 3.1 Policy Engine (moat продукта — делать первым в фазе)
- Декларативные правила: max amount per tx/day/asset; allowed recipients/networks/tools; запрет contract call без явного approve; first-time recipient over threshold → confirm; slippage/bridge risk thresholds; session duration + revoke triggers.
- Deny by default. Каждый AI/automation action → policy evaluation → результат, причины, applied policy ids, user approval artifact — в append-only лог.
- UI: permissions dashboard, шаблоны политик, revoke button.
- Таблицы: `policies`, `policy_evaluations`.
- **Приёмка:** test suite доказывает, что запрещённое действие невозможно исполнить в обход политики.

### 3.2 Нейра command interface («send 20 USDT Максу»)
- Архитектура: intent parser → context assembler → tool router (deterministic tools only) → policy checker → confirmation sheet → signer → audit.
- MVP-команды: навигация + информация; затем low-risk actions; send — только со structured confirmation card + step-up auth.
- Safety: prompt-injection фильтры, tool schema validation, jailbreak detection, red-team набор промптов в CI.
- Таблицы: `ai_intents`, `tool_calls`, `confirmations`, `executions`.
- **Приёмка:** каждое денежное действие имеет deterministic tool call + auditable confirm; ambiguous intent («какому Максу?») → уточнение, не угадывание.

### 3.3 Token approvals scanner + WalletConnect/domain risk
- Скан активных approvals с revoke; domain warnings; WalletConnect session list в Security center.
- **Приёмка:** rogue approval виден и отзывается из приложения.

### 3.4 DeFi positions + PnL
- Position parser, cost basis engine, staking → затем протоколы по allowlist с risk labels.
- Таблицы: `positions`, `pnl_lots`, `rewards_events`.
- **Приёмка:** regression set поддерживаемых протоколов классифицируется корректно.

### 3.5 Trade hub: bridge + off-ramp, multi-provider routing
- Единая поверхность buy/swap/bridge/sell: пользователь выбирает outcome, роутинг под капотом; route explanation от Нейры.
- **Приёмка:** fee disclosure до commit для всех типов сделок; bridge risk tiering применяется.

### 3.6 Premium subscription (AI + Safety)
- Entitlements server-side; план: advanced AI (recap, router assistant, monitoring), приоритетные risk-фичи.
- Таблицы: `subscriptions`, `entitlements`.
- **Приёмка:** entitlement гейтит premium API; распространяется за минуты.

### 3.7 Shared vaults (v1)
- Совместные «пространства» (пара/семья/команда) с ролями и подтверждениями — на базе policy engine.
- **Приёмка:** действие вне роли невозможно; все approvals в audit.

### 3.8 Invoices + split bill (Telegram-native)
- Развитие 1.5: инвойсы со статусами и напоминаниями (Нейра пишет follow-up), split bill между контактами через Telegram share.
- Таблицы: `invoices`, `splits`.
- **Приёмка:** partial/over-payment обрабатываются; статусы обновляются onchain/internal.

**Gate фазы 3:** независимый security-аудит / pentest. Только после него — разговор о real-money масштабировании.

---

## Фаза 4 — Advanced (6–12 месяцев, только после аудита)

Порядок уточняется по метрикам, всё — partner-driven и compliance-first:

- **Card layer**: сначала waitlist + spend abstraction + subscription center; потом virtual cards + USDC funding через issuing-партнёра (BIN sponsor). PCI-сегментация, tokenized PAN only.
- **Business accounts**: approvals, роли, positive-pay-like политики получателей (паттерн Mercury/Brex).
- **Автоматизации с guardrails**: DCA / limit / recurring через session keys, ограниченные policy (сумма, время, адресаты, функции).
- **Tax assistant**, отчёты (premium pack).
- **B2B / white-label** wallet tooling.
- **Compliance**: перед любым fiat/custodial шагом — юрисдикционный анализ (MiCA/CASP в ЕС, MSB/FinCEN в США, Travel Rule). Написать `COMPLIANCE.md` до, а не после.

---

## Целевая архитектура (ориентир для всех фаз)

```
Telegram Mini App / Web (Next.js) → API Gateway / BFF (auth, rate limits, flags, entitlements)
    ├── Auth & Identity        (Telegram binding, passkey, NeuroID, device trust)
    ├── Wallet Orchestration   (create/import, signers, recovery, smart accounts)
    ├── Transaction Service    (drafts, simulation, broadcast, status)
    ├── Portfolio & Market     (registry, prices, snapshots, positions, PnL)
    ├── Trade Router           (swap/bridge/ramps quote normalization)
    ├── Risk Engine            (address/token/dApp/domain scoring, poisoning)
    ├── Policy Engine          (limits, allowlists, tool scopes, sessions)
    ├── AI Orchestration       (intent parser → tools → policy → cards)
    ├── Notification Service   (event bus, rules, digests)
    ├── Billing / Entitlements
    └── Audit & Analytics      (append-only, trace ids, warehouse)
```

Данные: PostgreSQL (transactional) + time-series (snapshots/prices) + event bus + analytics warehouse. Секреты backend — KMS; device-side — Secure Enclave/Keychain/provider SDK. Мониторинг: Sentry, SBOM/dependency scanning, fraud-дашборды, trace ids насквозь.

Ключевые North-star метрики: wallet creation → first funded → first successful send conversion; warning override rate; AI action completion rate; alias vs raw address share; quote acceptance; security incidents per MAU; WAU/MAU; revenue per funded wallet.

---

## Что НЕ делать (сводка запретов)

1. Не давать Нейре доступ к ключам — никогда, ни в какой фазе.
2. Не запускать real money до Gate фазы 0 + аудита фазы 3.
3. Не выпускать токен.
4. Не строить новые UI-экраны, пока открыта Фаза 0.
5. Не обещать «bank account» / карты до партнёров и лицензионной модели.
6. Не строить market data на одном провайдере.
7. Не полагаться на LLM для оценки риска транзакций — risk engine детерминированный, LLM только объясняет.
8. Не хранить на сервере ничего, что позволяет единолично восстановить кошелёк пользователя.

---

## Документация (писать по мере стабилизации, из CLAUDE.md)

| Файл | Когда |
|---|---|
| `ARCHITECTURE.md` | После Фазы 0 (стратегия зафиксирована: non-custodial + layered custody) |
| `KEY_MANAGEMENT.md` | После 0.5 и 2.1 |
| `API_SPEC.md` | После 0.3 |
| `SUPABASE_SCHEMA.md` | После 0.7 |
| `AI_AGENT_POLICY.md` | После 3.1–3.2 |
| `RUNBOOK.md` | Перед prod-деплоем |
| `COMPLIANCE.md` | Перед Фазой 4 (fiat/cards) |
