-- NeuroWallet — Фаза 1, задача 1.6: devices (security center lite).
-- Идемпотентно.
--
-- Устройство = (user, sha256(user-agent)). Хэш и метка считаются СЕРВЕРОМ
-- (/api/device-ping) — клиент не может подделать чужую строку: вставка
-- только через service role, у пользователя лишь SELECT своих устройств.

CREATE TABLE IF NOT EXISTS public.devices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ua_hash    TEXT NOT NULL,
  ua_label   TEXT,                -- усечённый читаемый user-agent
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT devices_unique UNIQUE (user_id, ua_hash)
);

CREATE INDEX IF NOT EXISTS devices_user_seen_idx
  ON public.devices (user_id, last_seen DESC);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devices_select_own" ON public.devices;
CREATE POLICY "devices_select_own"
  ON public.devices FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
-- INSERT/UPDATE — только service role (bypass RLS) из /api/device-ping.
