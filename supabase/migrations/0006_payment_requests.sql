-- NeuroWallet — Фаза 1, задача 1.5: payment_requests + payment_events.
-- Идемпотентно.
--
-- Модель доступа:
--  * создание/отмена/завершение — владелец, под его JWT (RLS ниже);
--  * резолв по ссылке — АНОНИМНЫЙ (плательщик может быть не залогинен),
--    выполняется службой /api/payment-request через service role по точному
--    uuid; политики для anon НЕТ намеренно — перебор невозможен без id
--    (см. NIGHT_DECISIONS.md D-1.5-1).
--
-- PRIVACY: содержит адрес и сумму — та же категория, что tx_drafts/contacts
-- (блок в SUPABASE_SCHEMA.md). Создатель ссылки сознательно делится этими
-- данными с получателем ссылки.

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coin       TEXT NOT NULL CHECK (coin IN ('BTC','ETH','SOL','USDT','TRX','TRC20','TON','USDT_TON')),
  amount     NUMERIC CHECK (amount IS NULL OR amount > 0), -- NULL = «любая сумма»
  address    TEXT NOT NULL CHECK (char_length(address) BETWEEN 1 AND 128),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_requests_user_idx
  ON public.payment_requests (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_payment_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_requests_updated_at ON public.payment_requests;
CREATE TRIGGER payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_payment_requests_updated_at();

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_requests_select_own" ON public.payment_requests;
CREATE POLICY "payment_requests_select_own"
  ON public.payment_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "payment_requests_insert_own" ON public.payment_requests;
CREATE POLICY "payment_requests_insert_own"
  ON public.payment_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "payment_requests_update_own" ON public.payment_requests;
CREATE POLICY "payment_requests_update_own"
  ON public.payment_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── payment_events — статусный след ссылки ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.payment_requests(id) ON DELETE CASCADE,
  event      TEXT NOT NULL CHECK (event IN ('created','viewed','completed','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_request_idx
  ON public.payment_events (request_id, created_at);

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_events_select_own" ON public.payment_events;
CREATE POLICY "payment_events_select_own"
  ON public.payment_events FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payment_requests p WHERE p.id = request_id AND p.user_id = auth.uid()));
-- insert событий — только service role (viewed/expired пишет резолвер).
