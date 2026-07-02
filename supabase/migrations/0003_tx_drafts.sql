-- NeuroWallet — Фаза 1, задача 1.2: tx_drafts + simulation_results.
-- Идемпотентно. Записи создаются через POST/PATCH /api/tx-draft под JWT
-- пользователя — RLS «только своё» на обеих таблицах.
--
-- ВНИМАНИЕ (privacy): tx_drafts содержит ФИНАНСОВОЕ ПОВЕДЕНИЕ пользователя
-- (адреса получателей, суммы, монеты). Это осознанное решение — на этих
-- данных стоят anti-poisoning эвристики (1.3) и address book (1.4).
-- При любом GDPR/privacy-ревью эта таблица проверяется первой.
-- Эти данные НЕ попадают в analytics_events и тексты уведомлений.

CREATE TABLE IF NOT EXISTS public.tx_drafts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coin       TEXT NOT NULL CHECK (coin IN ('BTC','ETH','SOL','USDT','TRX','TRC20','TON','USDT_TON')),
  to_address TEXT NOT NULL CHECK (char_length(to_address) BETWEEN 1 AND 128),
  amount     NUMERIC NOT NULL CHECK (amount > 0),
  trace_id   UUID,
  status     TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','sent','failed')),
  tx_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tx_drafts_user_created_idx
  ON public.tx_drafts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tx_drafts_trace_idx
  ON public.tx_drafts (trace_id) WHERE trace_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_tx_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tx_drafts_updated_at ON public.tx_drafts;
CREATE TRIGGER tx_drafts_updated_at
  BEFORE UPDATE ON public.tx_drafts
  FOR EACH ROW EXECUTE FUNCTION public.handle_tx_drafts_updated_at();

ALTER TABLE public.tx_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tx_drafts_select_own" ON public.tx_drafts;
CREATE POLICY "tx_drafts_select_own"
  ON public.tx_drafts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tx_drafts_insert_own" ON public.tx_drafts;
CREATE POLICY "tx_drafts_insert_own"
  ON public.tx_drafts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tx_drafts_update_own" ON public.tx_drafts;
CREATE POLICY "tx_drafts_update_own"
  ON public.tx_drafts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── simulation_results ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.simulation_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id     UUID NOT NULL REFERENCES public.tx_drafts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('ok','timeout','error')),
  fee_native   NUMERIC,
  fee_currency TEXT,
  fee_eur      NUMERIC,
  warnings     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS simulation_results_draft_idx
  ON public.simulation_results (draft_id);

ALTER TABLE public.simulation_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "simulation_results_select_own" ON public.simulation_results;
CREATE POLICY "simulation_results_select_own"
  ON public.simulation_results FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tx_drafts d WHERE d.id = draft_id AND d.user_id = auth.uid()));

DROP POLICY IF EXISTS "simulation_results_insert_own" ON public.simulation_results;
CREATE POLICY "simulation_results_insert_own"
  ON public.simulation_results FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tx_drafts d WHERE d.id = draft_id AND d.user_id = auth.uid()));
