-- NeuroWallet — Фаза 1, задача 1.4: contacts (address book + favorites).
-- Идемпотентно. RLS «только своё»; мутации через /api/contacts (JWT).
--
-- PRIVACY: как и tx_drafts, contacts содержит финансовое поведение
-- (адреса и имена получателей). Проверяется при GDPR-ревью вместе с
-- tx_drafts (см. блок в SUPABASE_SCHEMA.md). В analytics_events и
-- audit_log адреса/имена из contacts не попадают.

CREATE TABLE IF NOT EXISTS public.contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  coin        TEXT NOT NULL CHECK (coin IN ('BTC','ETH','SOL','USDT','TRX','TRC20','TON','USDT_TON')),
  address     TEXT NOT NULL CHECK (char_length(address) BETWEEN 1 AND 128),
  neuro_id    TEXT CHECK (neuro_id IS NULL OR neuro_id ~ '^nw-[a-z0-9]{8,32}$'),
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contacts_unique_per_user UNIQUE (user_id, coin, address)
);

CREATE INDEX IF NOT EXISTS contacts_user_fav_idx
  ON public.contacts (user_id, is_favorite DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_updated_at ON public.contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_contacts_updated_at();

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_select_own" ON public.contacts;
CREATE POLICY "contacts_select_own"
  ON public.contacts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_insert_own" ON public.contacts;
CREATE POLICY "contacts_insert_own"
  ON public.contacts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_update_own" ON public.contacts;
CREATE POLICY "contacts_update_own"
  ON public.contacts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_delete_own" ON public.contacts;
CREATE POLICY "contacts_delete_own"
  ON public.contacts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
