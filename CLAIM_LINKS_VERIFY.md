# 2.8 claim-links — live-verify (read-only) + rollback

> Часть A хвоста задачи 2.8. Все запросы **только SELECT** — БД не меняют.
> Прогнать в Supabase SQL Editor **на PRODUCTION** после смоука одной тестовой
> claim-ссылки в Mini App. Заменить `:REF` на `id` ссылки (значение из `?ref=` диплинка).

Реальные имена событий (сверено с кодом):

| Шаг цикла (из промпта) | `claim_events.event` | `analytics_events.event` |
|---|---|---|
| created        | `created` | `claim_link_created`  |
| opened         | `opened`  | `claim_link_opened`   |
| wallet_created | —         | `claim_wallet_created`|
| completed      | `claimed` | `claim_completed`     |
| (истёк/возврат)| `expired` | `claim_link_expired` / `claim_link_returned` |

`claim_events` пишет: `created`, `opened`, `claimed`, `expired`.
`wallet_created` живёт только в `analytics_events` (онбординг из клейма) — в
`claim_events` отдельного шага нет by design.

---

## 1. Полный цикл событий по одной ссылке

```sql
-- 1a. Карточка ссылки: статус, актив/сеть, сумма, кто заклеймил, срок.
SELECT id, status, asset, network, amount, is_demo,
       sender_user_id, claimed_by_user_id,
       created_at, updated_at, expires_at
FROM   public.claim_links
WHERE  id = ':REF';

-- 1b. Доменные события claim_events по этой ссылке (в порядке времени).
--     Ожидаем: created → opened → claimed (и/или expired при истечении).
SELECT event, actor_user_id, session_id, meta, created_at
FROM   public.claim_events
WHERE  claim_id = ':REF'
ORDER  BY created_at ASC;

-- 1c. Аналитические события этого флоу. Склейка по session_id (в properties нет
--     ref/сумм/адресов — анти-PII: только asset/network/demo).
--     Ожидаем: claim_link_created → claim_link_opened → claim_wallet_created → claim_completed.
SELECT event, user_id, session_id, trace_id, properties, created_at
FROM   public.analytics_events
WHERE  event LIKE 'claim\_%' ESCAPE '\'
  AND  session_id IN (SELECT session_id FROM public.claim_events WHERE claim_id = ':REF')
ORDER  BY created_at ASC;
```

## 1d. Единый таймлайн (объединяет оба источника, один экран)

```sql
SELECT 'claim_event'  AS source, event, created_at, meta AS payload
FROM   public.claim_events
WHERE  claim_id = ':REF'
UNION ALL
SELECT 'analytics'    AS source, event, created_at, properties AS payload
FROM   public.analytics_events
WHERE  event LIKE 'claim\_%' ESCAPE '\'
  AND  session_id IN (SELECT session_id FROM public.claim_events WHERE claim_id = ':REF')
ORDER  BY created_at ASC;
```

---

## 2. RLS включён на обеих таблицах

```sql
-- Ожидаем rowsecurity = true для обеих строк.
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM   pg_class
WHERE  relname IN ('claim_links', 'claim_events')
  AND  relnamespace = 'public'::regnamespace;

-- Действующие политики (для наглядности: что именно разрешено и кому).
SELECT tablename, policyname, cmd, roles, qual
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('claim_links', 'claim_events')
ORDER  BY tablename, policyname;
```

---

## Откат (rollback) — одной строкой

При флаге **OFF** фича полностью инертна: клиент не рендерит claim-CTA
(`NEXT_PUBLIC_CLAIM_LINKS_ENABLED !== 'true'` → все claim-роуты возвращают 403/скрыты),
БД не трогается — **мгновенный откат = `NEXT_PUBLIC_CLAIM_LINKS_ENABLED=false` + redeploy**
(таблицы `claim_links`/`claim_events` можно оставить: без флага в них никто не пишет).
