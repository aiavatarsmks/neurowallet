-- NeuroWallet — Фаза 2, задача 2.8: claim-ссылки (v1 demo, схема под v1/v2/v3).
-- Идемпотентно.
--
-- Инварианты: приватного ключа / секрета в raw виде на backend НЕТ — только
-- secret_hash (sha256 фрагмент-секрета из URL после '#'). Вставки/переходы
-- статуса — ТОЛЬКО через service role (маршруты /api/claim/*); клиент напрямую
-- не пишет (deny by default). Все критичные переходы дублируются в audit_log.
--
-- Поля рассчитаны на все три фазы, чтобы v2/v3 не мигрировали:
--   v1 demo:     ephemeral_address = NULL, is_demo = true (симуляция, без цепочки)
--   v2 testnet:  ephemeral_address = адрес temp-кошелька (ключ — в '#', не тут)
--   v3 mainnet:  escrow-контракт (target_tg_id / require_auth против перехвата)

CREATE TABLE IF NOT EXISTS public.claim_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- = claim ref в ?ref=
  sender_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL для demo/anon
  sender_session_id  UUID,                    -- эфемерный id вкладки (demo-отправитель без auth)
  target_tg_id       TEXT,                    -- опц. привязка к получателю (анти-перехват, v3)
  require_auth       BOOLEAN NOT NULL DEFAULT false,
  asset              TEXT NOT NULL,           -- напр. 'USDT_TON' | 'TON'
  network            TEXT NOT NULL DEFAULT 'ton',
  amount             NUMERIC NOT NULL CHECK (amount > 0),
  secret_hash        TEXT NOT NULL,           -- sha256(секрет из '#'); raw секрет НЕ хранится
  ephemeral_address  TEXT,                    -- v2/v3: адрес temp-кошелька; NULL в v1
  status             TEXT NOT NULL DEFAULT 'created'
                       CHECK (status IN ('created','funded','claimed','expired','returned')),
  is_demo            BOOLEAN NOT NULL DEFAULT false,
  dedupe_key         TEXT NOT NULL,           -- idempotency: одна активная ссылка на перевод
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ровно одна НЕистёкшая (активная) ссылка на перевод: uniq по dedupe_key,
-- пока статус активен.
CREATE UNIQUE INDEX IF NOT EXISTS claim_links_active_dedupe_idx
  ON public.claim_links (dedupe_key) WHERE status IN ('created','funded');
CREATE INDEX IF NOT EXISTS claim_links_sender_idx  ON public.claim_links (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS claim_links_session_idx ON public.claim_links (sender_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS claim_links_status_exp_idx ON public.claim_links (status, expires_at);

ALTER TABLE public.claim_links ENABLE ROW LEVEL SECURITY;

-- Отправитель видит свои ссылки (authed путь v2/v3). Demo-отправитель без auth
-- видит ссылку локально; серверная валидация — в /api/claim/*.
DROP POLICY IF EXISTS "claim_links_select_own" ON public.claim_links;
CREATE POLICY "claim_links_select_own"
  ON public.claim_links FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_user_id);
-- INSERT/UPDATE — только service role (bypass RLS) из /api/claim/*. Явных
-- authenticated-политик на запись нет намеренно (deny by default). Lookup по
-- ref для получателя — через server-route (не RLS), отдаёт только не-чувствительное.

-- ── Событийный лог claim (для аналитики/аудита) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.claim_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       UUID NOT NULL REFERENCES public.claim_links(id) ON DELETE CASCADE,
  event          TEXT NOT NULL
                   CHECK (event IN ('created','opened','claimed','expired','returned')),
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id     UUID,
  meta           JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_events_claim_idx ON public.claim_events (claim_id, created_at);

ALTER TABLE public.claim_events ENABLE ROW LEVEL SECURITY;
-- Только service role пишет/читает (deny by default): нет authenticated-политик.
-- Отправитель видит статус через claim_links; claim_events — внутренний.
