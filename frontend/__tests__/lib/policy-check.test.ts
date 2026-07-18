import { describe, it, expect } from 'vitest';
import {
  toScaledAmount, toEnginePolicy, evaluateSend, POLICY_AMOUNT_SCALE,
  type RawPolicy, type SendParams,
} from '@/lib/policy-check';

const send = (over: Partial<SendParams> = {}): SendParams => ({
  coin: 'TON', displayAmount: 10, recipient: 'addr-B', network: 'ton',
  recipientIsFirstTime: false, ...over,
});

describe('policy-check — amount scaling', () => {
  it('scales display amounts to BigInt micro-units', () => {
    expect(toScaledAmount(1.5)).toBe(BigInt(1.5 * POLICY_AMOUNT_SCALE));
    expect(toScaledAmount(100)).toBe(100_000_000n);
    expect(toScaledAmount(-5)).toBe(0n);
    expect(toScaledAmount(NaN)).toBe(0n);
  });
});

describe('policy-check — rule deserialization', () => {
  it('converts string amounts to BigInt', () => {
    const p = toEnginePolicy({ id: 'a', enabled: true, type: 'max_amount_per_tx', rule: { maxAmount: '50000000', asset: 'TON' } });
    expect(p).toEqual({ id: 'a', enabled: true, rule: { type: 'max_amount_per_tx', asset: 'TON', maxAmount: 50_000_000n } });
  });
  it('returns null for an unknown type', () => {
    expect(toEnginePolicy({ id: 'a', enabled: true, type: 'nonsense', rule: {} })).toBeNull();
  });
});

describe('policy-check — evaluateSend (end to end over stored rows)', () => {
  const perTx: RawPolicy = { id: 'p1', enabled: true, type: 'max_amount_per_tx', rule: { maxAmount: String(50 * POLICY_AMOUNT_SCALE) } };

  it('denies a send over the per-tx limit, allows within', () => {
    expect(evaluateSend([perTx], send({ displayAmount: 100 })).effect).toBe('deny');
    expect(evaluateSend([perTx], send({ displayAmount: 50 })).effect).toBe('allow');
  });
  it('denies a blocked recipient', () => {
    const blk: RawPolicy = { id: 'p2', enabled: true, type: 'blocked_recipients', rule: { addresses: ['addr-EVIL'] } };
    expect(evaluateSend([blk], send({ recipient: 'addr-EVIL' })).effect).toBe('deny');
    expect(evaluateSend([blk], send({ recipient: 'addr-OK' })).effect).toBe('allow');
  });
  it('confirms a first-time recipient over threshold', () => {
    const ft: RawPolicy = { id: 'p3', enabled: true, type: 'first_time_recipient_confirm', rule: { thresholdAmount: String(5 * POLICY_AMOUNT_SCALE) } };
    expect(evaluateSend([ft], send({ recipientIsFirstTime: true, displayAmount: 10 })).effect).toBe('confirm');
    expect(evaluateSend([ft], send({ recipientIsFirstTime: true, displayAmount: 1 })).effect).toBe('allow');
  });
  it('skips invalid rows without throwing', () => {
    const bad = { id: 'x', enabled: true, type: 'bogus', rule: {} } as RawPolicy;
    expect(evaluateSend([bad, perTx], send({ displayAmount: 100 })).effect).toBe('deny');
  });
  it('no policies → allow', () => {
    expect(evaluateSend([], send()).effect).toBe('allow');
  });
});
