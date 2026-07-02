-- NeuroWallet — Phase 0, task 0.7: RLS on all user tables + append-only audit log.
-- Idempotent: safe to run repeatedly in the Supabase SQL Editor.
--
-- Findings this migration fixes (verified against the live DB, 2026-07-02):
--   * public.profiles did not exist (tg-auth upsert was silently failing)
--   * public.neuro_directory did not exist (NeuroID resolve was broken)
--   * public.audit_log existed with RLS but was not append-only

-- ─── profiles ───────────────────────────────────────────────────────────────
-- Schema matches exactly what pages/api/tg-auth.ts upserts.

CREATE TABLE IF NOT EXISTS public.profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id         BIGINT,
  telegram_username   TEXT,
  telegram_first_name TEXT,
  telegram_last_name  TEXT,
  telegram_photo_url  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_profiles_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Deny by default: only the owner can see or modify their profile row.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─── neuro_directory ────────────────────────────────────────────────────────
-- Same content as NeuroWallet/supabase_neuro_id_migration.sql (never applied).
-- Read is intentionally open to all authenticated users: this is the public
-- alias directory that /api/neuro-id/resolve serves.

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

-- ─── audit_log ──────────────────────────────────────────────────────────────
-- Table already exists in the live DB with RLS enabled; re-assert idempotently
-- and make it append-only at the database level. Inserts happen only via the
-- service role (which bypasses RLS but NOT triggers). No policies are created
-- for anon/authenticated — deny by default.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  action     TEXT NOT NULL,
  metadata   JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
  ON public.audit_log (user_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
