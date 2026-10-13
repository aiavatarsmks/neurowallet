import { describe, it, expect, vi } from 'vitest';
import { recapFacts } from '@/lib/neura/facts';
import { validateFacts } from '@/pages/api/neura-explain';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn(),
}));

const SNAPSHOT = {
  eth: 0, sol: 0, btc: 0.5, trx: 0, ton: 10, usdt: 0, usdtTrc: 0, usdtTon: 20,
  ethEur: 3000, solEur: 150, btcEur: 100_000, trxEur: 0.3, tonEur: 2.5, usdtEur: 0.86,
  btcChange24h: 1, tonChange24h: -2,
};

describe('recapFacts: unavailable balances are never stated as a number', () => {
  it('omits unavailable coins from coins and from the total, and lists them', () => {
    // ETH failed with no last good value (0 placeholder); TON failed but has a last known 10.
    const r = recapFacts({ ...SNAPSHOT, unavailable: ['ETH', 'TON', 'USDT_TRC'] });
    expect(r.coins.map((c) => c.coin)).toEqual(['BTC', 'USDT_TON']);
    expect(r.coins.find((c) => c.coin === 'ETH')).toBeUndefined();
    expect(r.unavailable).toEqual(['ETH', 'TON', 'TRC20']);
    expect(r.totalEur).toBeCloseTo(0.5 * 100_000 + 20 * 0.86, 2);
  });

  it('without unavailable assets the recap is unchanged (USDT valued at the live usdtEur)', () => {
    const r = recapFacts(SNAPSHOT);
    expect(r.coins.map((c) => c.coin)).toEqual(['BTC', 'TON', 'USDT_TON']);
    expect(r.unavailable).toEqual([]);
    expect(r.coins.find((c) => c.coin === 'USDT_TON')?.eur).toBeCloseTo(17.2, 2);
  });

  it('the facts still pass the server-side validator', () => {
    const r = recapFacts({ ...SNAPSHOT, unavailable: ['ETH'] });
    const v = validateFacts(r) as { coins: Array<{ coin: string }> } | null;
    expect(v).not.toBeNull();
    expect(v?.coins.map((c) => c.coin)).not.toContain('ETH');
  });
});
