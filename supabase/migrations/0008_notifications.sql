-- NeuroWallet — Фаза 2, задача 2.4: notifications (in-app inbox v1).
-- Идемпотентно.
--
-- In-app inbox. Вставка ТОЛЬКО через service role (POST /api/notifications/emit,
-- текст композитится сервером по allowlist-шаблонам — клиент не шлёт свой текст,
-- никаких сумм/полных адресов). Пользователь читает свои и помечает прочитанным.
-- Доставка в Telegram, preference center и quiet hours — отдельно (не в этой
-- миграции): рассылка тестерам требует явного решения.

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- tx_sent | security_alert | weekly_recap | ...
  title      TEXT NOT NULL,            -- композитится сервером
  body       TEXT,                     -- композитится сервером
  meta       JSONB,                    -- только не-чувствительное (coin, trace_id, короткий хэш)
  dedupe_key TEXT,                     -- идемпотентность (одно уведомление на событие)
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
-- Дедуп: одно уведомление на (user, dedupe_key), когда ключ задан.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Пользователь видит только свои уведомления.
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT — только service role (bypass RLS) из /api/notifications/emit.
-- UPDATE (пометка read_at) — тоже через service role из /api/notifications/read,
-- чтобы клиент не мог менять чужие/иные поля. Явных authenticated-политик на
-- INSERT/UPDATE нет намеренно (deny by default).
