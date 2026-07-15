import { describe, it, expect } from 'vitest';
import { TON_NATIVE_SYMBOLS, tonNativeFirst } from '@/lib/crypto/assets';

describe('tonNativeFirst — 2.10 TON-native home positioning', () => {
  it('hoists TON-native assets above non-TON ones', () => {
    const rows = [
      { symbol: 'BTC' }, { symbol: 'ETH' }, { symbol: 'SOL' },
      { symbol: 'USDT' }, { symbol: 'TRX' }, { symbol: 'USDT_TRC' },
      { symbol: 'TON' }, { symbol: 'USDT_TON' },
    ];
    const out = tonNativeFirst(rows).map((r) => r.symbol);
    // TON + USDT_TON first...
    expect(out.slice(0, 2)).toEqual(['TON', 'USDT_TON']);
    // ...and no TON-native asset appears after any non-TON asset.
    const firstNonTon = out.findIndex((s) => !TON_NATIVE_SYMBOLS.has(s));
    const lastTon = out.map((s) => TON_NATIVE_SYMBOLS.has(s)).lastIndexOf(true);
    expect(lastTon).toBeLessThan(firstNonTon);
  });

  it('preserves the relative order of non-TON assets (stable)', () => {
    const rows = [{ symbol: 'BTC' }, { symbol: 'ETH' }, { symbol: 'SOL' }, { symbol: 'TRX' }];
    expect(tonNativeFirst(rows).map((r) => r.symbol)).toEqual(['BTC', 'ETH', 'SOL', 'TRX']);
  });

  it('preserves the relative order of the TON-native group', () => {
    const rows = [{ symbol: 'USDT_TON' }, { symbol: 'BTC' }, { symbol: 'TON' }];
    expect(tonNativeFirst(rows).map((r) => r.symbol)).toEqual(['USDT_TON', 'TON', 'BTC']);
  });

  it('does not mutate the input array', () => {
    const rows = [{ symbol: 'BTC' }, { symbol: 'TON' }];
    const copy = [...rows];
    tonNativeFirst(rows);
    expect(rows).toEqual(copy);
  });

  it('handles an all-TON or all-non-TON list without change', () => {
    expect(tonNativeFirst([{ symbol: 'BTC' }, { symbol: 'ETH' }]).map((r) => r.symbol)).toEqual(['BTC', 'ETH']);
    expect(tonNativeFirst([{ symbol: 'TON' }, { symbol: 'USDT_TON' }]).map((r) => r.symbol)).toEqual(['TON', 'USDT_TON']);
  });
});
