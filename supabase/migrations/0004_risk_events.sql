-- NeuroWallet — Фаза 1, задача 1.3: risk_events + override_actions.
-- Идемпотентно. Применять ПОСЛЕ 0003_tx_drafts.sql (FK на tx_drafts).
--
-- Privacy: адресов здесь НЕТ (см. NIGHT_DECISIONS.md D-1.3-2) — только коды
-- причин, уровень, монета и связки draft_id/trace_id. Сами адреса живут
-- исключительно в tx_drafts.

CREATE TABLE IF NOT EXISTS public.risk_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_id   UUID REFERENCES public.tx_drafts(id) ON DELETE SET NULL,
  coin       TEXT NOT NULL CHECK (coin IN ('BTC','ETH','SOL','USDT','TRX','TRC20','TON','USDT_TON')),
  level      TEXT NOT NULL CHECK (level IN ('warning','block')),
  reasons    JSONB NOT NULL,
  trace_id   UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS risk_events_user_created_idx
  ON public.risk_events (user_id, created_at DESC);

ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "risk_events_select_own" ON public.risk_events;
CREATE POLICY "risk_events_select_own"
  ON public.risk_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "risk_events_insert_own" ON public.risk_events;
CREATE POLICY "risk_events_insert_own"
  ON public.risk_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─── override_actions — каждый осознанный override рискованной отправки ────

CREATE TABLE IF NOT EXISTS public.override_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  risk_event_id UUID NOT NULL REFERENCES public.risk_events(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS override_actions_user_idx
  ON public.override_actions (user_id, created_at DESC);

ALTER TABLE public.override_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "override_actions_select_own" ON public.override_actions;
CREATE POLICY "override_actions_select_own"
  ON public.override_actions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "override_actions_insert_own" ON public.override_actions;
CREATE POLICY "override_actions_insert_own"
  ON public.override_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.risk_events r WHERE r.id = risk_event_id AND r.user_id = auth.uid())
  );
