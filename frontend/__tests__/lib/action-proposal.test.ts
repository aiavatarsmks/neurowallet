import { describe, it, expect } from 'vitest';
import { buildProposal, canProceed } from '@/lib/action-proposal';
import type { Policy, ProposedAction } from '@/lib/policy-engine';

const action = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  kind: 'send', asset: 'TON', amount: 100n, recipient: 'addr-B', network: 'ton',
  isContractCall: false, recipientIsFirstTime: false, daySpentForAsset: 0n, ...over,
});
const P = (id: string, rule: Policy['rule']): Policy => ({ id, enabled: true, rule });
const validArgs = { asset: 'TON', amount: '100', recipient: 'addr-B' };

describe('action-proposal — firewall gates first', () => {
  it('an invalid tool call is blocked before any policy evaluation', () => {
    const p = buildProposal('prepare_send', { asset: 'TON' } /* missing amount+recipient */, action(), []);
    expect(p.status).toBe('blocked');
    expect(p.policy).toBeNull(); // never reached the engine
    expect(canProceed(p, true)).toBe(false);
  });
  it('an unknown/executing tool never proposes', () => {
    const p = buildProposal('broadcast_tx', {}, action(), []);
    expect(p.status).toBe('blocked');
  });
});

describe('action-proposal — policy drives status', () => {
  it('ready when nothing objects', () => {
    const p = buildProposal('prepare_send', validArgs, action(), []);
    expect(p.status).toBe('ready');
    expect(canProceed(p, false)).toBe(true); // no confirmation needed
  });
  it('needs_confirmation on a soft policy (first-time recipient)', () => {
    const pols = [P('p1', { type: 'first_time_recipient_confirm', thresholdAmount: 50n })];
    const p = buildProposal('prepare_send', validArgs, action({ recipientIsFirstTime: true }), pols);
    expect(p.status).toBe('needs_confirmation');
    expect(canProceed(p, false)).toBe(false); // must confirm
    expect(canProceed(p, true)).toBe(true);
  });
  it('blocked on a hard policy (over per-tx limit) — cannot proceed even if confirmed', () => {
    const pols = [P('p1', { type: 'max_amount_per_tx', maxAmount: 10n })];
    const p = buildProposal('prepare_send', validArgs, action({ amount: 100n }), pols);
    expect(p.status).toBe('blocked');
    expect(canProceed(p, true)).toBe(false);
  });
});

describe('action-proposal — explainability', () => {
  it('explains a block with the policy reason', () => {
    const pols = [P('p1', { type: 'blocked_recipients', addresses: ['addr-B'] })];
    const p = buildProposal('prepare_send', validArgs, action(), pols);
    expect(p.status).toBe('blocked');
    expect(p.explanation.join(' ')).toMatch(/blocked/i);
    expect(p.explanation.some((l) => /block list/i.test(l))).toBe(true);
  });
  it('explains an allow', () => {
    const p = buildProposal('prepare_send', validArgs, action(), []);
    expect(p.explanation.join(' ')).toMatch(/allowed/i);
  });
});
