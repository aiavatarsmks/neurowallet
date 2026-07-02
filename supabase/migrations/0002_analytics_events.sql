-- NeuroWallet — Фаза 1, задача 1.1: analytics_events.
-- Идемпотентно. Вставка ТОЛЬКО через POST /api/track (service role) —
-- политик для anon/authenticated нет намеренно (deny by default).

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = анонимное pre-auth событие
  session_id UUID NOT NULL,      -- эфемерный id вкладки (sessionStorage), склейка anon → user
  event      TEXT NOT NULL,      -- имя из серверного allowlist (pages/api/track.ts)
  properties JSONB,              -- только разрешённые ключи, без PII (фильтруется сервером)
  trace_id   UUID,               -- сквозной id флоу: тот же uuid попадает в audit_log.metadata.trace_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_event_created_idx
  ON public.analytics_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_trace_idx
  ON public.analytics_events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS analytics_events_session_idx
  ON public.analytics_events (session_id);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
