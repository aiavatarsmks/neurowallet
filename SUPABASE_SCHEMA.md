# NeuroWallet — Supabase: схема и конфигурация

> Актуально на 2026-07-02, после применения `supabase/migrations/0001_rls_phase0.sql`
> и финальной RLS-верификации (кросс-проверка двух тестовых пользователей —
> все 9 проверок изоляции прошли).

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

Файл: `supabase/migrations/0001_rls_phase0.sql` — идемпотентный, применяется
целиком через SQL Editor. История: до Фазы 0 таблиц `profiles` и
`neuro_directory` в живой базе **не существовало** (старая миграция
`NeuroWallet/supabase_neuro_id_migration.sql` не была применена) — upsert
профилей и NeuroID-резолв молча не работали.

Следующие таблицы (Фаза 1): `analytics_events`, `tx_drafts`,
`simulation_results`, `risk_events`, `contacts` и др. — каждая добавляется
новым файлом `supabase/migrations/NNNN_*.sql` с RLS с первого дня.
