-- NeuroWallet — Фаза 3, задача 3.1: Policy Engine (moat).
-- Идемпотентно и АДДИТИВНО (как 0010). Два объекта:
--   • policies            — декларативные правила пользователя (лимиты, allow/block).
--   • policy_evaluations  — append-only лог решений движка (effect, reasons,
--                           applied policy ids) для аудита и приёмки.
--
-- Инварианты: policies — пользователь управляет своими (CRUD под JWT). Запись в
--   policy_evaluations — ТОЛЬКО service role (лог), клиент не пишет (deny by
--   default). Активируется флагом NEXT_PUBLIC_POLICY_ENGINE_ENABLED; при OFF
--   движок не подключён к send/AI (чистый rollback). Суммы/адреса в лог не
--   пишем — только тип действия, актив, effect, id политик, машинные коды причин.

-- ── Пользовательские политики ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  type        TEXT NOT NULL CHECK (type IN (
                'max_amount_per_tx','max_amount_per_day','allowed_networks',
                'blocked_recipients','first_time_recipient_confirm',
                'require_approval_for_contract','allow_automation')),
  rule        JSONB NOT NULL,   -- параметры правила (см. PolicyRule в lib/policy-engine.ts)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policies_user_enabled_idx
  ON public.policies (user_id, enabled);

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

-- Пользователь управляет своими политиками (CRUD под JWT).
DROP POLICY IF EXISTS "policies_select_own" ON public.policies;
CREATE POLICY "policies_select_own" ON public.policies
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "policies_insert_own" ON public.policies;
CREATE POLICY "policies_insert_own" ON public.policies
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "policies_update_own" ON public.policies;
CREATE POLICY "policies_update_own" ON public.policies
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "policies_delete_own" ON public.policies;
CREATE POLICY "policies_delete_own" ON public.policies
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── Append-only журнал решений движка ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policy_evaluations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode               TEXT NOT NULL CHECK (mode IN ('user','automation')),
  action_kind        TEXT NOT NULL,
  asset              TEXT,
  effect             TEXT NOT NULL CHECK (effect IN ('allow','confirm','deny')),
  applied_policy_ids JSONB,   -- id сработавших политик
  reasons            JSONB,   -- машинные коды + безопасные сообщения (без сумм/адресов)
  trace_id           UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_evaluations_user_created_idx
  ON public.policy_evaluations (user_id, created_at DESC);

ALTER TABLE public.policy_evaluations ENABLE ROW LEVEL SECURITY;

-- Пользователь видит свой журнал; запись — только service role (append-only).
DROP POLICY IF EXISTS "policy_evaluations_select_own" ON public.policy_evaluations;
CREATE POLICY "policy_evaluations_select_own" ON public.policy_evaluations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- INSERT — только service role (deny by default для authenticated). UPDATE/DELETE
-- не разрешаем никому (append-only): политик на них нет.
