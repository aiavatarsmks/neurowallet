/**
 * Demo dataset is the single source of truth for demo-mode figures. These
 * tests lock in that totals are the sum of their parts (so home / portfolio /
 * send can't silently diverge again) and that every supported asset has a
 * holding.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_ASSETS } from '@/lib/crypto/assets';
import {
  DEMO_HOLDINGS, demoValueEUR, DEMO_HOLDING, DEMO_CRYPTO_TOTAL_EUR,
  DEMO_FIAT_ACCOUNTS, DEMO_FIAT_TOTAL_EUR, DEMO_TOTAL_EUR,
} from '@/lib/demo-data';

describe('demo-data', () => {
  it('has exactly one holding per supported asset', () => {
    const symbols = DEMO_HOLDINGS.map((h) => h.symbol).sort();
    const expected = SUPPORTED_ASSETS.map((a) => a.symbol).sort();
    expect(symbols).toEqual(expected);
  });

  it('crypto total equals the sum of holding values', () => {
    const sum = DEMO_HOLDINGS.reduce((s, h) => s + demoValueEUR(h), 0);
    expect(DEMO_CRYPTO_TOTAL_EUR).toBeCloseTo(sum, 6);
  });

  it('fiat total equals the sum of fiat accounts, and grand total adds up', () => {
    const fiat = DEMO_FIAT_ACCOUNTS.reduce((s, a) => s + a.valueEUR, 0);
    expect(DEMO_FIAT_TOTAL_EUR).toBeCloseTo(fiat, 6);
    expect(DEMO_TOTAL_EUR).toBeCloseTo(DEMO_CRYPTO_TOTAL_EUR + DEMO_FIAT_TOTAL_EUR, 6);
  });

  it('every chain has a non-zero demo balance (no "0 in portfolio, non-zero in send" gap)', () => {
    for (const h of DEMO_HOLDINGS) expect(h.amount).toBeGreaterThan(0);
    // spot-check the ones that previously diverged
    expect(DEMO_HOLDING.TON.amount).toBeGreaterThan(0);
    expect(DEMO_HOLDING.USDT_TRC.amount).toBeGreaterThan(0);
    expect(DEMO_HOLDING.TRX.amount).toBeGreaterThan(0);
  });
});
