import { describe, it, expect, afterEach, vi } from 'vitest';
import { simulateTransfer, isBlocked, type SimCoin } from '@/lib/crypto/simulate';

const BALANCES: Record<SimCoin, number> = {
  ETH: 1, BTC: 0.05, SOL: 10, USDT: 100, TRX: 500, TRC20: 50, TON: 20, USDT_TON: 30,
};
const RATES = { eth: 2800, btc: 55000, sol: 120, trx: 0.22, ton: 3.5 };

const SOL_ADDR = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const ETH_ADDR = '0x' + 'a'.repeat(40);
const TRON_ADDR = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';

function base(coin: SimCoin, over: Partial<Parameters<typeof simulateTransfer>[0]> = {}) {
  return { coin, toAddress: SOL_ADDR, amount: 1, balances: BALANCES, eurRates: RATES, timeoutMs: 200, ...over };
}

afterEach(() => vi.unstubAllGlobals());

describe('simulateTransfer (task 1.2)', () => {
  it('ok path: SOL native transfer with static fee and balance delta', async () => {
    const r = await simulateTransfer(base('SOL', { amount: 2 }));
    expect(r.status).toBe('ok');
    expect(r.feeNative).toBeCloseTo(0.000005, 9);
    expect(r.feeCurrency).toBe('SOL');
    expect(r.balanceAfter).toBeCloseTo(10 - 2 - 0.000005, 6);
    expect(r.warnings).toEqual([]);
    expect(isBlocked(r)).toBe(false);
  });

  it('chain/token mismatch: ETH-address for SOL coin → block invalid_address', async () => {
    const r = await simulateTransfer(base('SOL', { toAddress: ETH_ADDR }));
    expect(r.warnings).toContainEqual({ level: 'block', code: 'invalid_address' });
    expect(isBlocked(r)).toBe(true);
  });

  it('invalid amount → block', async () => {
    const r = await simulateTransfer(base('SOL', { amount: 0 }));
    expect(r.warnings).toContainEqual({ level: 'block', code: 'invalid_amount' });
  });

  it('insufficient native funds including fee → block', async () => {
    const r = await simulateTransfer(base('SOL', { amount: 10 })); // 10 + fee > 10
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_funds' });
  });

  it('token transfer with empty native fee balance → block insufficient_fee_balance', async () => {
    const r = await simulateTransfer(
      base('TRC20', { toAddress: TRON_ADDR, amount: 10, balances: { ...BALANCES, TRX: 0 } }),
    );
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_fee_balance' });
  });

  it('RPC timeout → status timeout with explicit warn, deterministic checks still applied', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* висит вечно */ })));
    const r = await simulateTransfer(base('ETH', { toAddress: ETH_ADDR, amount: 0.5, timeoutMs: 100 }));
    expect(r.status).toBe('timeout');
    expect(r.feeNative).toBeNull();
    expect(r.warnings).toContainEqual({ level: 'warn', code: 'simulation_timeout' });
    expect(isBlocked(r)).toBe(false); // timeout предупреждает, но не блокирует
  });

  it('timeout does not mask a real blocker (insufficient funds)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const r = await simulateTransfer(base('ETH', { toAddress: ETH_ADDR, amount: 5, timeoutMs: 100 }));
    expect(r.status).toBe('timeout');
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_funds' });
    expect(isBlocked(r)).toBe(true);
  });
});
