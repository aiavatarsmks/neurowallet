-- NeuroWallet: public NeuroID directory
-- Run this in Supabase SQL Editor after profiles migration.

CREATE TABLE IF NOT EXISTS public.neuro_directory (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  neuro_id      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  eth_address   TEXT,
  sol_address   TEXT,
  btc_address   TEXT,
  tron_address  TEXT,
  ton_address   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT neuro_directory_id_format CHECK (neuro_id ~ '^nw-[a-z0-9]{8,32}$')
);

CREATE INDEX IF NOT EXISTS neuro_directory_neuro_id_idx
  ON public.neuro_directory (neuro_id);

CREATE OR REPLACE FUNCTION public.handle_neuro_directory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS neuro_directory_updated_at ON public.neuro_directory;
CREATE TRIGGER neuro_directory_updated_at
  BEFORE UPDATE ON public.neuro_directory
  FOR EACH ROW EXECUTE FUNCTION public.handle_neuro_directory_updated_at();

ALTER TABLE public.neuro_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "neuro_directory_public_read" ON public.neuro_directory;
CREATE POLICY "neuro_directory_public_read"
  ON public.neuro_directory FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "neuro_directory_insert_own" ON public.neuro_directory;
CREATE POLICY "neuro_directory_insert_own"
  ON public.neuro_directory FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "neuro_directory_update_own" ON public.neuro_directory;
CREATE POLICY "neuro_directory_update_own"
  ON public.neuro_directory FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
