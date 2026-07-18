/**
 * lib/policy-check.ts — bridge between stored policies (DB JSON, string amounts)
 * and the pure Policy Engine (lib/policy-engine, BigInt amounts), plus the
 * adapter that turns a send into a ProposedAction. Pure and testable.
 *
 * Amount convention for POLICIES (not chain amounts): a policy limit compares the
 * transfer's *display* amount scaled by POLICY_AMOUNT_SCALE (1e6, 6 dp) as BigInt.
 * This is provider/token-decimal-agnostic — "max 100 TON" and "send 1.5 TON" are
 * both scaled the same way, so BigInt comparison is exact without per-token math.
 */

import {
  evaluateAction,
  type Policy,
  type PolicyRule,
  type PolicyDecision,
  type ProposedAction,
  type ActionKind,
  type EvalMode,
} from './policy-engine';

export const POLICY_AMOUNT_SCALE = 1_000_000; // 6 decimal places

/** Scale a display amount (e.g. 1.5 TON) to the policy BigInt unit. */
export function toScaledAmount(display: number): bigint {
  if (!Number.isFinite(display) || display < 0) return 0n;
  return BigInt(Math.round(display * POLICY_AMOUNT_SCALE));
}

/** DB row shape: rule is JSON with string amounts (JSONB-safe). */
export interface RawPolicy {
  id: string;
  enabled: boolean;
  type: string;
  rule: Record<string, unknown>;
}

const bigintFrom = (v: unknown): bigint => {
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return BigInt(v);
  return 0n;
};
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Convert a stored policy row into the engine's Policy (BigInt amounts). */
export function toEnginePolicy(raw: RawPolicy): Policy | null {
  const r = raw.rule ?? {};
  let rule: PolicyRule | null = null;
  switch (raw.type) {
    case 'max_amount_per_tx':
      rule = { type: 'max_amount_per_tx', asset: typeof r.asset === 'string' ? r.asset : undefined, maxAmount: bigintFrom(r.maxAmount) };
      break;
    case 'max_amount_per_day':
      rule = { type: 'max_amount_per_day', asset: typeof r.asset === 'string' ? r.asset : undefined, maxAmount: bigintFrom(r.maxAmount) };
      break;
    case 'allowed_networks':
      rule = { type: 'allowed_networks', networks: strArray(r.networks) };
      break;
    case 'blocked_recipients':
      rule = { type: 'blocked_recipients', addresses: strArray(r.addresses) };
      break;
    case 'first_time_recipient_confirm':
      rule = { type: 'first_time_recipient_confirm', thresholdAmount: bigintFrom(r.thresholdAmount) };
      break;
    case 'require_approval_for_contract':
      rule = { type: 'require_approval_for_contract' };
      break;
    case 'allow_automation':
      rule = {
        type: 'allow_automation',
        kinds: strArray(r.kinds) as ActionKind[],
        assets: r.assets !== undefined ? strArray(r.assets) : undefined,
        maxAmount: r.maxAmount !== undefined ? bigintFrom(r.maxAmount) : undefined,
        recipients: r.recipients !== undefined ? strArray(r.recipients) : undefined,
      };
      break;
    default:
      return null;
  }
  return { id: raw.id, enabled: raw.enabled, rule };
}

export interface SendParams {
  coin: string;
  displayAmount: number;
  recipient: string;
  network: string;
  recipientIsFirstTime: boolean;
  daySpentDisplay?: number; // already spent today for this coin (display units)
}

/** Build a ProposedAction for a send from UI params. */
export function buildSendAction(p: SendParams): ProposedAction {
  return {
    kind: 'send',
    asset: p.coin,
    amount: toScaledAmount(p.displayAmount),
    recipient: p.recipient,
    network: p.network,
    isContractCall: false,
    recipientIsFirstTime: p.recipientIsFirstTime,
    daySpentForAsset: toScaledAmount(p.daySpentDisplay ?? 0),
  };
}

/** Evaluate a send against stored policies. Invalid rows are skipped. */
export function evaluateSend(rawPolicies: RawPolicy[], send: SendParams, mode: EvalMode = 'user'): PolicyDecision {
  const policies = rawPolicies.map(toEnginePolicy).filter((p): p is Policy => p !== null);
  return evaluateAction(buildSendAction(send), policies, mode);
}
