-- NeuroWallet — 0012: neuro_directory becomes private + NeuroID anti-impersonation.
--
-- HOW TO APPLY: manually, whole file, in the Supabase SQL Editor (there is no
-- auto-apply). Idempotent: safe to run more than once.
--
-- ORDER-SAFE WITH THE CODE: /api/neuro-id/resolve now reads the directory with
-- the service role (server-only) for one exact neuro_id and itself rejects
-- rows whose neuro_id is not derived from user_id. So the app works the same
-- BEFORE and AFTER this migration; deploy and apply in either order.
--
-- What it fixes:
--   1. 0001 created "neuro_directory_public_read" (SELECT USING (true) for every
--      authenticated user). Email signup is open, so any self-registered
--      account could dump every user's display_name and all wallet addresses:
--        GET /rest/v1/neuro_directory?select=*
--      Now: SELECT only your own row. Nobody else reads it except the service
--      role (the resolver). INSERT/UPDATE stay "own row only".
--   2. Only the id FORMAT was checked, so a user could upsert a row holding
--      someone else's NeuroID (and receive payments sent to it, or block the
--      real owner, since neuro_id is UNIQUE). The client always writes
--      neuro_id = neuroIdFromUserId(user_id) (frontend/lib/neuro-id.ts,
--      unchanged since NeuroID was introduced):
--        'nw-' || first 12 hex chars of the uuid without dashes
--      Now enforced by CHECK neuro_directory_id_derived.
--
-- DATA NOTE: rows that violate (2) cannot come from the app and are DELETED
-- below (a NOTICE prints how many). The real owner's client re-creates its row
-- on the next profile sync (syncMyNeuroDirectory upsert). To look first, run:
--   SELECT user_id, neuro_id, display_name, updated_at
--     FROM public.neuro_directory
--    WHERE neuro_id <> 'nw-' || left(replace(user_id::text, '-', ''), 12);
--
-- The client upsert (INSERT ... ON CONFLICT (user_id) DO UPDATE) needs SELECT
-- on the existing row, which "select own" keeps working.
--
-- ROLLBACK (restores the 0001 behaviour, including the leak):
--   DROP POLICY IF EXISTS "neuro_directory_select_own" ON public.neuro_directory;
--   CREATE POLICY "neuro_directory_public_read" ON public.neuro_directory
--     FOR SELECT TO authenticated USING (true);
--   ALTER TABLE public.neuro_directory DROP CONSTRAINT IF EXISTS neuro_directory_id_derived;

ALTER TABLE public.neuro_directory ENABLE ROW LEVEL SECURITY;

-- ─── 1. Private reads ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "neuro_directory_public_read" ON public.neuro_directory;

DROP POLICY IF EXISTS "neuro_directory_select_own" ON public.neuro_directory;
CREATE POLICY "neuro_directory_select_own"
  ON public.neuro_directory FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Re-assert own-row writes exactly as in 0001 (idempotent).
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

-- ─── 2. neuro_id must be derived from user_id ───────────────────────────────

DO $$
DECLARE
  forged integer;
BEGIN
  DELETE FROM public.neuro_directory
   WHERE neuro_id <> 'nw-' || left(replace(user_id::text, '-', ''), 12);
  GET DIAGNOSTICS forged = ROW_COUNT;
  IF forged > 0 THEN
    RAISE NOTICE '0012: removed % neuro_directory row(s) whose neuro_id was not derived from user_id', forged;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'neuro_directory_id_derived'
       AND conrelid = 'public.neuro_directory'::regclass
  ) THEN
    ALTER TABLE public.neuro_directory
      ADD CONSTRAINT neuro_directory_id_derived
      CHECK (neuro_id = 'nw-' || left(replace(user_id::text, '-', ''), 12));
  END IF;
END $$;

-- ─── Verify (read-only, run after applying) ─────────────────────────────────
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'neuro_directory';
--   -- expect: neuro_directory_select_own / insert_own / update_own, no public_read
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.neuro_directory'::regclass;
--   -- expect: neuro_directory_id_derived among them
