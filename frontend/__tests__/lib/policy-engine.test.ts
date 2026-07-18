import { describe, it, expect } from 'vitest';
import {
  evaluateAction, isBlocked, type Policy, type ProposedAction,
} from '@/lib/policy-engine';

const action = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  kind: 'send', asset: 'TON', amount: 100n, recipient: 'addr-B', network: 'ton',
  isContractCall: false, recipientIsFirstTime: false, daySpentForAsset: 0n, ...over,
});
const P = (id: string, rule: Policy['rule'], enabled = true): Policy => ({ id, enabled, rule });

describe('policy-engine — per-tx / per-day limits (deny)', () => {
  it('denies over per-tx limit, allows within', () => {
    const pols = [P('p1', { type: 'max_amount_per_tx', asset: 'TON', maxAmount: 50n })];
    expect(evaluateAction(action({ amount: 100n }), pols).effect).toBe('deny');
    expect(evaluateAction(action({ amount: 50n }), pols).effect).toBe('allow');
  });
  it('denies when the daily total would be exceeded', () => {
    const pols = [P('p1', { type: 'max_amount_per_day', maxAmount: 200n })];
    expect(evaluateAction(action({ amount: 150n, daySpentForAsset: 100n }), pols).effect).toBe('deny');
    expect(evaluateAction(action({ amount: 100n, daySpentForAsset: 100n }), pols).effect).toBe('allow');
  });
  it('per-tx limit scoped to an asset does not affect other assets', () => {
    const pols = [P('p1', { type: 'max_amount_per_tx', asset: 'ETH', maxAmount: 1n })];
    expect(evaluateAction(action({ asset: 'TON', amount: 999n }), pols).effect).toBe('allow');
  });
});

describe('policy-engine — network / recipient blocks (deny)', () => {
  it('denies a network off the allowed list', () => {
    const pols = [P('p1', { type: 'allowed_networks', networks: ['ton'] })];
    expect(evaluateAction(action({ network: 'eth' }), pols).effect).toBe('deny');
    expect(evaluateAction(action({ network: 'ton' }), pols).effect).toBe('allow');
  });
  it('denies a blocked recipient', () => {
    const pols = [P('p1', { type: 'blocked_recipients', addresses: ['addr-EVIL'] })];
    expect(evaluateAction(action({ recipient: 'addr-EVIL' }), pols).effect).toBe('deny');
    expect(evaluateAction(action({ recipient: 'addr-OK' }), pols).effect).toBe('allow');
  });
});

describe('policy-engine — soft confirms', () => {
  it('confirms a first-time recipient over threshold, allows under', () => {
    const pols = [P('p1', { type: 'first_time_recipient_confirm', thresholdAmount: 100n })];
    expect(evaluateAction(action({ recipientIsFirstTime: true, amount: 100n }), pols).effect).toBe('confirm');
    expect(evaluateAction(action({ recipientIsFirstTime: true, amount: 99n }), pols).effect).toBe('allow');
    expect(evaluateAction(action({ recipientIsFirstTime: false, amount: 999n }), pols).effect).toBe('allow');
  });
  it('confirms a contract interaction', () => {
    const pols = [P('p1', { type: 'require_approval_for_contract' })];
    expect(evaluateAction(action({ isContractCall: true }), pols).effect).toBe('confirm');
    expect(evaluateAction(action({ isContractCall: false }), pols).effect).toBe('allow');
  });
});

describe('policy-engine — aggregation & metadata', () => {
  it('deny wins over confirm', () => {
    const pols = [
      P('p1', { type: 'first_time_recipient_confirm', thresholdAmount: 1n }),
      P('p2', { type: 'max_amount_per_tx', maxAmount: 10n }),
    ];
    const d = evaluateAction(action({ recipientIsFirstTime: true, amount: 100n }), pols);
    expect(d.effect).toBe('deny');
    expect(d.appliedPolicyIds).toEqual(expect.arrayContaining(['p1', 'p2']));
  });
  it('reports applied policy ids and reasons', () => {
    const pols = [P('p1', { type: 'max_amount_per_tx', maxAmount: 10n })];
    const d = evaluateAction(action({ amount: 100n }), pols);
    expect(d.appliedPolicyIds).toEqual(['p1']);
    expect(d.reasons[0]).toMatchObject({ policyId: 'p1', code: 'max_amount_per_tx', effect: 'deny' });
  });
  it('ignores disabled policies', () => {
    const pols = [P('p1', { type: 'max_amount_per_tx', maxAmount: 1n }, false)];
    expect(evaluateAction(action({ amount: 999n }), pols).effect).toBe('allow');
  });
  it('clean action with no governing policy is allowed (user mode)', () => {
    expect(evaluateAction(action(), []).effect).toBe('allow');
  });
});

describe('policy-engine — automation is DENY BY DEFAULT (the moat invariant)', () => {
  it('denies an automation action with no permitting policy', () => {
    const d = evaluateAction(action(), [], 'automation');
    expect(d.effect).toBe('deny');
    expect(d.reasons.some((r) => r.code === 'automation_denied_by_default')).toBe(true);
  });
  it('allows automation only within an allow_automation whitelist', () => {
    const pols = [P('p1', { type: 'allow_automation', kinds: ['send'], assets: ['TON'], maxAmount: 100n, recipients: ['addr-B'] })];
    expect(evaluateAction(action({ amount: 100n }), pols, 'automation').effect).toBe('allow');
    // over the automation max → denied
    expect(evaluateAction(action({ amount: 101n }), pols, 'automation').effect).toBe('deny');
    // wrong kind → denied
    expect(evaluateAction(action({ kind: 'swap' }), pols, 'automation').effect).toBe('deny');
    // recipient not whitelisted → denied
    expect(evaluateAction(action({ recipient: 'addr-X' }), pols, 'automation').effect).toBe('deny');
  });

  it('ACCEPTANCE: a forbidden action cannot pass — hard limit denies even if automation-whitelisted', () => {
    // An allow_automation permits it, but a hard per-tx limit still denies →
    // proves policy cannot be bypassed by whitelisting.
    const pols = [
      P('allow', { type: 'allow_automation', kinds: ['send'], maxAmount: 1_000_000n }),
      P('limit', { type: 'max_amount_per_tx', maxAmount: 100n }),
    ];
    const d = evaluateAction(action({ amount: 500n }), pols, 'automation');
    expect(d.effect).toBe('deny');
    expect(isBlocked(d)).toBe(true);
  });
});
