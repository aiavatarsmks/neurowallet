import { describe, it, expect, vi } from 'vitest';
import { simulateTransfer, isBlocked, type SimCoin } from '@/lib/crypto/simulate';

vi.mock('@/lib/crypto/eth-provider', () => ({
  getEthProvider: () => ({ getFeeData: () => new Promise(() => { /* never answers */ }) }),
}));

const BALANCES: Record<SimCoin, number> = {
  ETH: 0, BTC: 0, SOL: 0, USDT: 0, TRX: 0, TRC20: 0, TON: 0, USDT_TON: 0,
};
const RATES = { eth: 2800, btc: 55000, sol: 120, trx: 0.22, ton: 3.5 };
const SOL_ADDR = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('simulateTransfer with balances that did not load', () => {
  it('known 0 balance still blocks as insufficient', async () => {
    const r = await simulateTransfer({ coin: 'SOL', toAddress: SOL_ADDR, amount: 1, balances: BALANCES, eurRates: RATES, timeoutMs: 200 });
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_funds' });
  });

  it('unknown balance: warns instead of a false "insufficient", does not block', async () => {
    const r = await simulateTransfer({
      coin: 'SOL', toAddress: SOL_ADDR, amount: 1, balances: BALANCES, eurRates: RATES, timeoutMs: 200,
      unknownBalances: ['SOL'],
    });
    expect(r.warnings).toContainEqual({ level: 'warn', code: 'balance_unknown' });
    expect(r.warnings.some((w) => w.code === 'insufficient_funds')).toBe(false);
    expect(r.balanceAfter).toBeNull();
    expect(isBlocked(r)).toBe(false);
  });

  it('unknown fee-coin balance: no false insufficient_fee_balance for a token send', async () => {
    const r = await simulateTransfer({
      coin: 'USDT_TON', toAddress: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N', amount: 1,
      balances: { ...BALANCES, USDT_TON: 5 }, eurRates: RATES, timeoutMs: 200,
      unknownBalances: ['TON'],
    });
    expect(r.warnings.some((w) => w.code === 'insufficient_fee_balance')).toBe(false);
    expect(r.warnings).toContainEqual({ level: 'warn', code: 'balance_unknown' });
  });
});
