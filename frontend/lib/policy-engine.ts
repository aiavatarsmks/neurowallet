/**
 * lib/policy-engine.ts — pure, deterministic Policy Engine core (задача 3.1).
 * No secrets, no network, no crypto — safe on client and server, fully testable.
 *
 * This is the product moat (CLAUDE.md): every AI/automation money action must
 * pass a deterministic policy evaluation with reasons + applied policy ids before
 * it can be proposed to a signer. **Deny by default** for automation: an action
 * the policies do not explicitly permit is denied. User-initiated actions are
 * guarded by limit/blocklist policies (guardrails), not deny-by-default.
 *
 * What is NOT here (by design): the DB (`policies`, `policy_evaluations` —
 * migration 0011), the permissions UI, and the wiring into the real send/AI path
 * (that gates money and needs review). This file is the pure evaluator + types.
 * Amounts are BigInt in the token's smallest unit — never floats.
 */

export type ActionKind = 'send' | 'swap' | 'approve' | 'contract_call';
export type EvalMode = 'user' | 'automation';

/** A proposed action to evaluate. Amounts in smallest unit (BigInt). */
export interface ProposedAction {
  kind: ActionKind;
  asset: string;
  amount: bigint;
  recipient: string; // address or contact id; '' when N/A
  network: string;
  isContractCall: boolean;
  recipientIsFirstTime: boolean;
  /** Already spent today for this asset (smallest unit), for daily-limit checks. */
  daySpentForAsset: bigint;
}

/** Declarative policy rules (from the plan's 3.1 rule catalogue). */
export type PolicyRule =
  | { type: 'max_amount_per_tx'; asset?: string; maxAmount: bigint }
  | { type: 'max_amount_per_day'; asset?: string; maxAmount: bigint }
  | { type: 'allowed_networks'; networks: string[] }
  | { type: 'blocked_recipients'; addresses: string[] }
  | { type: 'first_time_recipient_confirm'; thresholdAmount: bigint }
  | { type: 'require_approval_for_contract' }
  | {
      // Automation whitelist: what an AI/automation action MAY do. Absence of a
      // matching allow in automation mode = deny by default.
      type: 'allow_automation';
      kinds: ActionKind[];
      assets?: string[];
      maxAmount?: bigint;
      recipients?: string[];
    };

export interface Policy {
  id: string;
  enabled: boolean;
  rule: PolicyRule;
}

export type Effect = 'allow' | 'confirm' | 'deny';

export interface PolicyReason {
  policyId: string;
  code: string; // machine-readable, e.g. 'max_amount_per_tx'
  effect: Exclude<Effect, 'allow'>;
  message: string; // safe, user-facing (no amounts/addresses leaked verbatim)
}

export interface PolicyDecision {
  effect: Effect;
  reasons: PolicyReason[];
  appliedPolicyIds: string[]; // policies that fired a constraint
}

function assetMatches(ruleAsset: string | undefined, actionAsset: string): boolean {
  return ruleAsset === undefined || ruleAsset === actionAsset;
}

function automationAllows(rule: Extract<PolicyRule, { type: 'allow_automation' }>, a: ProposedAction): boolean {
  if (!rule.kinds.includes(a.kind)) return false;
  if (rule.assets && !rule.assets.includes(a.asset)) return false;
  if (rule.maxAmount !== undefined && a.amount > rule.maxAmount) return false;
  if (rule.recipients && a.recipient && !rule.recipients.includes(a.recipient)) return false;
  return true;
}

/**
 * Evaluate a proposed action against the enabled policies. Deterministic and
 * pure. Aggregation: any `deny` → deny; else any `confirm` → confirm; else allow.
 * In automation mode, absence of a matching `allow_automation` policy → deny
 * (deny by default — the moat invariant).
 */
export function evaluateAction(
  action: ProposedAction,
  policies: Policy[],
  mode: EvalMode = 'user',
): PolicyDecision {
  const reasons: PolicyReason[] = [];
  const applied = new Set<string>();
  const enabled = policies.filter((p) => p.enabled);

  const add = (p: Policy, code: string, effect: 'deny' | 'confirm', message: string) => {
    reasons.push({ policyId: p.id, code, effect, message });
    applied.add(p.id);
  };

  for (const p of enabled) {
    const r = p.rule;
    switch (r.type) {
      case 'max_amount_per_tx':
        if (assetMatches(r.asset, action.asset) && action.amount > r.maxAmount) {
          add(p, r.type, 'deny', 'Amount exceeds the per-transaction limit.');
        }
        break;
      case 'max_amount_per_day':
        if (assetMatches(r.asset, action.asset) && action.daySpentForAsset + action.amount > r.maxAmount) {
          add(p, r.type, 'deny', 'This would exceed your daily limit.');
        }
        break;
      case 'allowed_networks':
        if (!r.networks.includes(action.network)) {
          add(p, r.type, 'deny', 'Network is not on your allowed list.');
        }
        break;
      case 'blocked_recipients':
        if (action.recipient && r.addresses.includes(action.recipient)) {
          add(p, r.type, 'deny', 'Recipient is on your block list.');
        }
        break;
      case 'first_time_recipient_confirm':
        if (action.recipientIsFirstTime && action.amount >= r.thresholdAmount) {
          add(p, r.type, 'confirm', 'First transfer to this recipient — please confirm.');
        }
        break;
      case 'require_approval_for_contract':
        if (action.isContractCall) {
          add(p, r.type, 'confirm', 'Contract interaction requires your approval.');
        }
        break;
      case 'allow_automation':
        // handled below (whitelist), not a per-policy violation
        break;
    }
  }

  // Deny by default for automation: need at least one allow_automation that permits this.
  if (mode === 'automation') {
    const permits = enabled.some(
      (p) => p.rule.type === 'allow_automation' && automationAllows(p.rule, action),
    );
    if (!permits) {
      reasons.push({
        policyId: '(default)',
        code: 'automation_denied_by_default',
        effect: 'deny',
        message: 'No policy permits this automated action.',
      });
    }
  }

  const effect: Effect = reasons.some((r) => r.effect === 'deny')
    ? 'deny'
    : reasons.some((r) => r.effect === 'confirm')
      ? 'confirm'
      : 'allow';

  return { effect, reasons, appliedPolicyIds: [...applied] };
}

/** Convenience: is the action executable without a blocking policy? */
export function isBlocked(decision: PolicyDecision): boolean {
  return decision.effect === 'deny';
}

/** Feature flag. Off by default — engine inert, not wired into send/AI yet. */
export function policyEngineEnabled(): boolean {
  return process.env.NEXT_PUBLIC_POLICY_ENGINE_ENABLED === 'true';
}
