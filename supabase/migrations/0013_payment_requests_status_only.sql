-- NeuroWallet — 0013: payment_requests owner may change only `status`.
--
-- HOW TO APPLY: manually, whole file, in the Supabase SQL Editor (there is no
-- auto-apply). Idempotent: safe to run more than once.
--
-- ORDER-SAFE WITH THE CODE: /api/payment-request PATCH (user JWT) only ever
-- sends { status } for an 'active' row (-> completed | cancelled), and the
-- anonymous resolver's lazy expiry (active -> expired) runs with the service
-- role. Both keep working before and after this migration.
--
-- What it fixes: the 0006 policy "payment_requests_update_own" let the owner
-- UPDATE any column, so a link already shared with a payer could be silently
-- rewritten (address / amount / expires_at) under the same URL. RLS policies
-- can't compare OLD and NEW, so a BEFORE UPDATE trigger does it:
--   * roles anon / authenticated (i.e. PostgREST under a user JWT): every
--     column except status and updated_at must stay unchanged (compared as
--     jsonb, so columns added later are protected by default), and status may
--     only move active -> completed | cancelled;
--   * service_role and postgres (server API, SQL editor) are not restricted.
-- Violations raise SQLSTATE 42501 (insufficient_privilege).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS payment_requests_owner_status_only ON public.payment_requests;
--   DROP FUNCTION IF EXISTS public.payment_requests_owner_status_only();

CREATE OR REPLACE FUNCTION public.payment_requests_owner_status_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- SECURITY INVOKER (default): current_user is the role running the UPDATE.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'payment_requests: only status can be changed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status IN ('completed', 'cancelled')) THEN
    RAISE EXCEPTION 'payment_requests: status % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_requests_owner_status_only ON public.payment_requests;
CREATE TRIGGER payment_requests_owner_status_only
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.payment_requests_owner_status_only();

-- ─── Verify (run after applying) ────────────────────────────────────────────
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.payment_requests'::regclass AND NOT tgisinternal;
--   -- expect: payment_requests_owner_status_only, payment_requests_updated_at
-- Behaviour check as a user (in a transaction you roll back):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '{"sub":"<owner uuid>","role":"authenticated"}', true);
--   UPDATE public.payment_requests SET address = 'x' WHERE id = '<id>';  -- ERROR 42501
--   UPDATE public.payment_requests SET status = 'cancelled' WHERE id = '<id>' AND status = 'active';  -- OK
--   ROLLBACK;
