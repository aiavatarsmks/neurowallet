import { describe, it, expect } from 'vitest';
import {
  bpsOf, applyMarkup, minReceived, buildFeeBreakdown,
  clampSlippageBps, isSwappableV1, DEFAULT_MARKUP_BPS, MAX_SLIPPAGE_BPS,
} from '@/lib/swap-quote';

describe('swap-quote — bps math (BigInt, money-safe)', () => {
  it('bpsOf floors like integer division', () => {
    expect(bpsOf(1_000_000n, 85)).toBe(8500n); // 0.85%
    expect(bpsOf(101n, 85)).toBe(0n); // 101*85/10000 = 0.8585 → 0
    expect(bpsOf(0n, 85)).toBe(0n);
  });
  it('rejects negative amount and invalid bps', () => {
    expect(() => bpsOf(-1n, 85)).toThrow();
    expect(() => bpsOf(100n, -1)).toThrow();
    expect(() => bpsOf(100n, 1.5)).toThrow();
  });
});

describe('swap-quote — margin is transparent and conserved', () => {
  it('applyMarkup splits gross into our fee + user net (no value lost)', () => {
    const { ourFee, netOut } = applyMarkup(1_000_000n, 85);
    expect(ourFee).toBe(8500n);
    expect(netOut).toBe(991_500n);
    expect(ourFee + netOut).toBe(1_000_000n); // conservation
  });
  it('zero markup takes nothing', () => {
    expect(applyMarkup(1_000_000n, 0)).toEqual({ ourFee: 0n, netOut: 1_000_000n });
  });
});

describe('swap-quote — slippage floor', () => {
  it('minReceived subtracts slippage from net', () => {
    expect(minReceived(1_000_000n, 100)).toBe(990_000n); // 1%
    expect(minReceived(1_000_000n, 0)).toBe(1_000_000n);
  });
});

describe('swap-quote — full breakdown', () => {
  it('exposes every number as a string; floor ≤ net ≤ gross', () => {
    const b = buildFeeBreakdown(1_000_000n, { markupBps: 85, slippageBps: 100 });
    expect(b).toEqual({
      grossOut: '1000000',
      markupBps: 85,
      ourFee: '8500',
      netOut: '991500',
      slippageBps: 100,
      minReceived: '981585', // 991500 - 1%
    });
    expect(BigInt(b.minReceived) <= BigInt(b.netOut)).toBe(true);
    expect(BigInt(b.netOut) <= BigInt(b.grossOut)).toBe(true);
  });
});

describe('swap-quote — config & guards', () => {
  it('default markup is the plan target (~0.85% = 85 bps)', () => {
    expect(DEFAULT_MARKUP_BPS).toBe(85);
  });
  it('clampSlippageBps clamps to the hard cap and defaults on garbage', () => {
    expect(clampSlippageBps(9999)).toBe(MAX_SLIPPAGE_BPS);
    expect(clampSlippageBps(50)).toBe(50);
    expect(clampSlippageBps(-1)).toBe(100); // default
    expect(clampSlippageBps('nope')).toBe(100);
  });
  it('v1 covers EVM+SOL+TON set only (TRX/BTC out of scope)', () => {
    expect(isSwappableV1('ETH')).toBe(true);
    expect(isSwappableV1('TON')).toBe(true);
    expect(isSwappableV1('USDT_TON')).toBe(true);
    expect(isSwappableV1('BTC')).toBe(false);
    expect(isSwappableV1('TRX')).toBe(false);
  });
});
