# NeuroWallet — Supabase: схема и конфигурация

> Актуально на **2026-07-18**, миграции **0001–0010** применены к prod-проекту
> (`jraysrewevsbbxtqnggz`, main/PRODUCTION). RLS повторно верифицирован вживую
> 2026-07-18 после 0010 — **все пользовательские таблицы: `rowsecurity = true`**
> (см. таблицу «RLS-статус» ниже). Инвариант един для всей схемы: чтение — «только
> своё» под JWT; запись — либо своя строка под JWT, либо **только service role**
> (analytics/audit/notifications/claim), клиент напрямую не пишет (deny by default).

## Таблицы

### public.profiles — Telegram-профили
Заполняется best-effort upsert'ом из `POST /api/tg-auth` под JWT пользователя.

| Колонка | Тип | Примечание |
|---|---|---|
| id | UUID PK → auth.users (CASCADE) | = auth.uid() владельца |
| telegram_id | BIGINT | |
| telegram_username / first_name / last_name / photo_url | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | updated_at — триггером |

**RLS**: select / insert / update — только `auth.uid() = id`. Чужой профиль
невидим и незаписываем. Публичного чтения нет (deny by default).

### public.neuro_directory — справочник NeuroID → адреса
Обслуживает `GET /api/neuro-id/resolve`. Формат id: `^nw-[a-z0-9]{8,32}$` (CHECK).

| Колонка | Тип |
|---|---|
| user_id | UUID PK → auth.users (CASCADE) |
| neuro_id | TEXT NOT NULL UNIQUE (+ индекс) |
| display_name, eth/sol/btc/tron/ton_address | TEXT |
| created_at / updated_at | TIMESTAMPTZ |

**RLS**: SELECT — все `authenticated` (публичный справочник, by design);
INSERT/UPDATE — только своя строка (`auth.uid() = user_id`).

### public.audit_log — append-only журнал
Пишется **только** service role из `lib/server/api-security.ts` (`writeAuditLog`).
Никаких политик для anon/authenticated → deny by default (проверено: select
пуст, insert → 42501). Триггер `audit_log_no_update_delete` запрещает
UPDATE/DELETE **на уровне БД** — даже для service role.

| Колонка | Тип |
|---|---|
| id | UUID PK default gen_random_uuid() |
| user_id | UUID NOT NULL → auth.users (без CASCADE — журнал переживает юзера; удаление юзера со строками журнала упрётся в FK, это осознанно) |
| action | TEXT NOT NULL |
| metadata | JSONB |
| ip_address | INET |
| user_agent | TEXT |
| created_at | TIMESTAMPTZ default now() (+ индекс user_id, created_at DESC) |

**Каталог событий** (что пишет код сейчас):
`tg_auth_login`, `ai_chat_requested`, `ai_chat_completed`, `ai_chat_failed`,
`tx_history_requested`, `telegram_notification_requested`,
`telegram_notification_sent`, `telegram_notification_failed`, `neuro_id_resolved`.

### public.analytics_events — продуктовая аналитика (задача 1.1)
Вставка только через `POST /api/track` (service role, allowlist имён событий
и ключей properties — анти-PII). RLS включён, политик нет (deny by default).
`user_id` NULL для анонимных pre-auth событий; склейка по `session_id`
(эфемерный uuid вкладки) через событие `session_identified`. `trace_id`
связывает события с `audit_log.metadata.trace_id` и `tx_drafts.trace_id`.
**Адреса и суммы сюда не пишутся никогда.**

### public.tx_drafts + public.simulation_results — send review (задача 1.2)

> ⚠️ **PRIVACY / GDPR**: `tx_drafts` содержит **финансовое поведение
> пользователя** — адреса получателей, суммы, монеты, статусы отправок.
> Это осознанное решение: на этих данных стоят anti-poisoning эвристики
> (задача 1.3: first-seen, similarity против recipient history) и address
> book (задача 1.4). При любом privacy/GDPR-ревью эта таблица проверяется
> ПЕРВОЙ. Эти данные не попадают в `analytics_events`, тексты уведомлений
> и `audit_log.metadata` (audit получает только draft_id и монету — покрыто
> тестом).

`tx_drafts`: id, user_id → auth.users (CASCADE), coin (CHECK по 8 монетам),
to_address (≤128), amount (>0), trace_id, status (drafted→sent/failed),
tx_hash, created/updated. Записи через `POST/PATCH /api/tx-draft` **под JWT
пользователя** — RLS select/insert/update только своё.

`simulation_results`: draft_id → tx_drafts (CASCADE), status (ok/timeout/error),
fee_native/fee_currency/fee_eur, warnings JSONB. RLS через принадлежность
родительского драфта.

Метрика приёмки 1.2 «≥95% отправок с preview» считается напрямую:
`count(tx_drafts)` vs `count(analytics_events where event='send_succeeded')`.

### public.contacts / public.payment_requests (задачи 1.4/1.5)
`contacts` — адресная книга (имя, монета, адрес, favorite; UNIQUE на
user+coin+address); `payment_requests` + `payment_events` — платёжные ссылки
(адрес, сумма, expiry, статусный след). Обе таблицы — та же privacy-категория,
что tx_drafts (см. блок выше): финансовое поведение, проверять при
GDPR-ревью. RLS «только своё»; анонимный резолв платёжной ссылки — через
service role по точному uuid (политик для anon нет), см. NIGHT_DECISIONS
D-1.5-1. Миграции: 0005, 0006.

### public.risk_events / public.override_actions (задача 1.3 — risk engine)
Anti-poisoning / risk engine. Пишутся под JWT через `POST /api/risk-event`.
- `risk_events`: id, user_id → auth.users (CASCADE), draft_id → tx_drafts (SET NULL),
  coin (CHECK по 8 монетам), **level** (`warning`|`block`), **reasons** JSONB,
  trace_id, created_at. RLS: select/insert — только своё.
- `override_actions`: id, user_id, risk_event_id → risk_events (CASCADE), created_at —
  фиксирует, что пользователь осознанно проигнорировал `warning`. RLS: select/insert своё.

Та же privacy-категория, что `tx_drafts` (финансовое поведение). Миграция 0004.

### public.devices (задача 1.6 — security center)
Список устройств/сессий для «центра безопасности». Пишется service role.
- id, user_id (CASCADE), **ua_hash** (не сырой UA), ua_label (усечённый читаемый UA),
  first_seen, last_seen, UNIQUE (user_id, ua_hash).
- RLS: select — только своё; запись — service role. Миграция 0007.

### public.notifications (задача 2.4 — in-app inbox)
Legacy inbox (основа для движка 2.4). Текст **композитится сервером** — клиент не
шлёт текст, только allowlisted `kind` (+ валидированная монета).
- id, user_id (CASCADE), kind, **title**, body, **meta** JSONB (только
  не-чувствительное: coin, trace_id, короткий хэш — ни сумм, ни полных адресов),
  **dedupe_key** (UNIQUE-индекс на (user_id, dedupe_key) → идемпотентность),
  read_at, created_at.
- RLS: select — только своё; **insert только service role** (маршруты
  `/api/notifications/*`). Миграция 0008.

### public.claim_links / public.claim_events (задача 2.8 — claim-ссылки)
Виральная петля «отправил X — забери» (demo v1). Пишутся service role.
- `claim_links`: id (= `?ref=`), sender_user_id (SET NULL, NULL для demo/anon),
  sender_session_id, asset, network (default `ton`), amount (>0), **secret_hash**
  (sha256; сырой секрет НЕ хранится, живёт только во фрагменте ссылки `#`), status
  (`created`→`opened`/`claimed`/`expired`), is_demo, **dedupe_key** (одна активная
  ссылка на перевод), claimed_by_user_id, expires_at, created/updated.
  Индексы: активный dedupe (UNIQUE), sender, session, (status, expires_at).
- `claim_events`: id, claim_id → claim_links (CASCADE), event
  (`created`/`opened`/`claimed`/`expired`), actor_user_id, session_id, meta, created_at.
- RLS: `claim_links` — select только своё (1 политика); `claim_events` — RLS on,
  **0 политик** намеренно (deny-all клиентам; читается только service role — журнал
  аудита/аналитики). Секрет проверяется хэшем на сервере. Миграция 0009.
  Read-only verify + rollback: `CLAIM_LINKS_VERIFY.md`.

### public.notification_rules / public.notification_deliveries (задача 2.4 — движок)
Rule engine поверх `notifications` (0008). Пишутся service role
(`/api/notifications/prefs`, `.../emit`, движок). Активируется флагом
`NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED`.
- `notification_rules` — preference center, одна строка на юзера: каналы
  (`telegram_enabled` opt-in; inbox всегда), типы (transactional/security/price/
  promotional; security не отключается на уровне enforcement), quiet hours
  (`quiet_start_min`/`quiet_end_min` [0..1439] + `tz_offset_min` [-840..840], CHECK),
  updated_at. RLS: select своё; upsert — только service role (deny by default на запись).
- `notification_deliveries` — журнал доставок: kind, category (CHECK 4 значения),
  channel (`inbox`|`telegram`), status (`sent`|`suppressed`|`deduped`|`failed`),
  reason, dedupe_key, created_at. **UNIQUE-индекс** на (user_id, channel, dedupe_key)
  `WHERE status='sent'` — реальная гарантия дедупа; второй индекс (user, category,
  status, created_at DESC) — окно promo-rate-limit (≤2/нед). RLS: select своё;
  insert service role. Миграция 0010.

## RLS-статус (верифицировано 2026-07-18, prod)

Все пользовательские таблицы — `rowsecurity = true`. Проверка провелась после
применения 0010 (`pg_class.relrowsecurity` + `pg_policies`):

| Таблица | RLS | Политик | Запись |
|---|---|---|---|
| profiles | ✅ | 3 (select/insert/update own) | своя строка под JWT |
| neuro_directory | ✅ | 3 (public read + insert/update own) | своя строка |
| audit_log | ✅ | 0 (+ триггер append-only) | service role only |
| analytics_events | ✅ | 0 | service role (`/api/track`) |
| tx_drafts / simulation_results | ✅ | select/insert(/update) own | своя строка под JWT |
| risk_events / override_actions | ✅ | select/insert own | своя строка под JWT |
| contacts | ✅ | select/insert/update/delete own | своя строка |
| payment_requests / payment_events | ✅ | select(/insert/update) own | своя + anon-резолв через service role |
| devices | ✅ | select own | service role |
| notifications | ✅ | 1 (select own) | service role |
| claim_links | ✅ | 1 (select own) | service role |
| claim_events | ✅ | 0 (deny-all клиентам by design) | service role |
| notification_rules | ✅ | 1 (select own) | service role (upsert) |
| notification_deliveries | ✅ | 1 (select own) | service role |

## Конфигурация Auth (задача 0.7)

| Параметр | Значение | Где |
|---|---|---|
| Access token (JWT) expiry | **900 сек** | Dashboard → Project Settings → JWT Keys → Legacy JWT Secret |
| Refresh token rotation + reuse detection | включено, reuse interval 10 сек | Auth → Sessions |
| Time-box / inactivity timeout сессий | **недоступно на Free-плане** — принятое ограничение | — |
| Email autoconfirm | включён (нужен для детерминированных tg-аккаунтов) | Auth → Providers |
| Инвалидация сессий при смене пароля | флоу смены пароля в приложении нет; при появлении — обязателен `signOut({scope:'global'})` | требование к будущему коду |

`initData` Mini App проверяется на backend при каждом логине: HMAC-подпись +
freshness `auth_date` ≤ 15 минут (`pages/api/tg-auth.ts`, покрыто тестами).

## Ключи

- **anon key** — публичный, но бесполезен без RLS-политик: анонимный select
  по всем таблицам пуст, insert отбивается 42501 (проверено probe'ами).
- **service role key** — только в env Vercel (`SUPABASE_SERVICE_ROLE_KEY`),
  используется единственной функцией `writeAuditLog`. В клиентском коде
  запрещён навсегда.

## Миграции

Все миграции идемпотентны/аддитивны, применяются целиком через SQL Editor
(Максим — вручную; автоприменения нет). Каждая новая таблица идёт с RLS с
первого дня. История: до Фазы 0 таблиц `profiles`/`neuro_directory` в живой
базе **не существовало** (старая `NeuroWallet/supabase_neuro_id_migration.sql`
не была применена) — upsert профилей и NeuroID-резолв молча не работали.

| # | Файл | Таблицы | Задача |
|---|---|---|---|
| 0001 | `0001_rls_phase0.sql` | profiles, neuro_directory, audit_log | Фаза 0 (RLS) |
| 0002 | `0002_analytics_events.sql` | analytics_events | 1.1 |
| 0003 | `0003_tx_drafts.sql` | tx_drafts, simulation_results | 1.2 |
| 0004 | `0004_risk_events.sql` | risk_events, override_actions | 1.3 |
| 0005 | `0005_contacts.sql` | contacts | 1.4 |
| 0006 | `0006_payment_requests.sql` | payment_requests, payment_events | 1.5 |
| 0007 | `0007_devices.sql` | devices | 1.6 |
| 0008 | `0008_notifications.sql` | notifications | 2.4 (inbox) |
| 0009 | `0009_claim_links.sql` | claim_links, claim_events | 2.8 |
| 0010 | `0010_notification_engine.sql` | notification_rules, notification_deliveries | 2.4 (движок) |

**Применено к prod:** 0001–0010 (0010 — 2026-07-18). При добавлении миграции
обновляй эту таблицу и «RLS-статус» выше.
