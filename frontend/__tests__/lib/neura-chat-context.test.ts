import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { chatWalletContext } from '@/components/NeuraChat';

describe('chatWalletContext', () => {
  it('drops balances of assets that did not load, keeps the rest', () => {
    const ctx = {
      eth: 0, usdt: 0, usdtTrc: 12, trx: 3, usdtTon: 0, sol: 1, btc: 0.1, ton: 5,
      ethEur: 2800, solEur: 120, btcEur: 55000, trxEur: 0.2, tonEur: 3, usdtEur: 0.9,
      ethChange24h: 0, solChange24h: 0, btcChange24h: 0, trxChange24h: 0, tonChange24h: 0, priceUpdatedAt: 0,
      unavailable: ['ETH', 'USDT', 'USDT_TRC'] as const,
      pricesStale: false, btcPending: 0, usdPerEur: 1.08,
      ethAddr: '0x' + 'a'.repeat(40),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = chatWalletContext(ctx as any)!;
    expect(out.eth).toBeUndefined();
    expect(out.usdt).toBeUndefined();
    expect(out.usdtTrc).toBeUndefined();
    expect(out.unavailable).toBeUndefined();
    expect(out.btc).toBe(0.1);
    expect(out.ton).toBe(5);
    expect(out.ethAddr).toBe('0x' + 'a'.repeat(40));
  });
  it('undefined in, undefined out', () => {
    expect(chatWalletContext(undefined)).toBeUndefined();
  });
});
