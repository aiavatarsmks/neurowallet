-- NeuroWallet — Фаза 2, задача 2.4: notification engine v1 (доделки поверх 0008).
-- Идемпотентно и АДДИТИВНО (как 0009): существующую таблицу notifications (0008)
-- НЕ трогаем. Добавляем два новых объекта:
--   • notification_rules  — preference center (каналы, типы, quiet hours) на юзера.
--   • notification_deliveries — журнал доставок (канал/статус/причина) для дедупа,
--     rate-limit (promo ≤ 2/нед), аудита и приёмки «дубликаты не доставляются».
--
-- Инварианты: запись в обе таблицы — ТОЛЬКО через service role (маршруты
--   /api/notifications/*); клиент напрямую не пишет (deny by default). В текстах
--   и meta — никакой чувствительной информации (суммы/полные адреса/секреты).
-- Фича активируется флагом NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED=true; при
--   OFF новые маршруты инертны, а legacy inbox (0008) работает как раньше.

-- ── Preference center: одна строка правил на пользователя ────────────────────
CREATE TABLE IF NOT EXISTS public.notification_rules (
  user_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Каналы. Inbox всегда включён (не интрузивный pull-surface); telegram — opt-in.
  telegram_enabled      BOOLEAN NOT NULL DEFAULT false,
  -- Типы (категории). security НЕ отключается на уровне enforcement (см. engine),
  -- но флаг храним для полноты preference center.
  transactional_enabled BOOLEAN NOT NULL DEFAULT true,
  security_enabled      BOOLEAN NOT NULL DEFAULT true,
  price_enabled         BOOLEAN NOT NULL DEFAULT true,
  promotional_enabled   BOOLEAN NOT NULL DEFAULT true,
  -- Quiet hours: локальные минуты от полуночи [0..1439] + смещение зоны от UTC.
  quiet_hours_enabled   BOOLEAN  NOT NULL DEFAULT false,
  quiet_start_min       SMALLINT NOT NULL DEFAULT 1320 CHECK (quiet_start_min BETWEEN 0 AND 1439), -- 22:00
  quiet_end_min         SMALLINT NOT NULL DEFAULT 480  CHECK (quiet_end_min   BETWEEN 0 AND 1439), -- 08:00
  tz_offset_min         SMALLINT NOT NULL DEFAULT 0    CHECK (tz_offset_min BETWEEN -840 AND 840),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

-- Пользователь читает только свои правила.
DROP POLICY IF EXISTS "notification_rules_select_own" ON public.notification_rules;
CREATE POLICY "notification_rules_select_own"
  ON public.notification_rules FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
-- INSERT/UPDATE — только service role из /api/notifications/prefs (валидация +
-- upsert). Явных authenticated-политик на запись нет намеренно (deny by default).

-- ── Журнал доставок: что/куда/с каким исходом ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,   -- tx_sent | tx_failed | claim_received | security_alert | price_alert | weekly_recap
  category    TEXT NOT NULL CHECK (category IN ('transactional','security','price','promotional')),
  channel     TEXT NOT NULL CHECK (channel IN ('inbox','telegram')),
  status      TEXT NOT NULL CHECK (status IN ('sent','suppressed','deduped','failed')),
  reason      TEXT,            -- ok | category_off | channel_off | quiet_hours | rate_limited | duplicate | error
  dedupe_key  TEXT,            -- один и тот же ключ события → не доставляем повторно в тот же канал
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Дедуп доставки: не более одной УСПЕШНОЙ доставки на (user, channel, dedupe_key).
-- suppressed/deduped/failed строки индекс не блокирует — их журналим для аудита.
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_sent_dedupe_idx
  ON public.notification_deliveries (user_id, channel, dedupe_key)
  WHERE status = 'sent' AND dedupe_key IS NOT NULL;
-- Rate-limit окно (promo ≤ 1–2/нед) считается по этому индексу.
CREATE INDEX IF NOT EXISTS notification_deliveries_user_cat_created_idx
  ON public.notification_deliveries (user_id, category, status, created_at DESC);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

-- Пользователь видит свою историю доставок (для UI/дебага); запись — service role.
DROP POLICY IF EXISTS "notification_deliveries_select_own" ON public.notification_deliveries;
CREATE POLICY "notification_deliveries_select_own"
  ON public.notification_deliveries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
-- INSERT — только service role (deny by default для authenticated).
