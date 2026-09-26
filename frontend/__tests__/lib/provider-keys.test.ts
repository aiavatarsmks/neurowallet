// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { toncenterHeaders, trongridHeaders, etherscanApiKey } from '@/lib/server/provider-keys';
import { fetchTronAccountBalances, parseTronAccount } from '@/lib/crypto/tron-tx';
import { fetchTonBalanceStrict } from '@/lib/crypto/ton-tx';

const TON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

afterEach(() => {
  delete process.env.TONCENTER_API_KEY;
  delete process.env.TRONGRID_API_KEY;
  delete process.env.ETHERSCAN_API_KEY;
  vi.unstubAllGlobals();
});

describe('provider-keys (server-only env)', () => {
  it('no env → no headers / undefined (previous keyless behaviour)', () => {
    expect(toncenterHeaders()).toEqual({});
    expect(trongridHeaders()).toEqual({});
    expect(etherscanApiKey()).toBeUndefined();
  });
  it('env set → provider-specific header names; blank values ignored', () => {
    process.env.TONCENTER_API_KEY = 'a';
    process.env.TRONGRID_API_KEY = 'b';
    process.env.ETHERSCAN_API_KEY = '   ';
    expect(toncenterHeaders()).toEqual({ 'X-API-Key': 'a' });
    expect(trongridHeaders()).toEqual({ 'TRON-PRO-API-KEY': 'b' });
    expect(etherscanApiKey()).toBeUndefined();
  });
});

describe('balance fetchers accept a server key', () => {
  it('toncenter getAddressBalance sends X-API-Key only when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: '2500000000' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTonBalanceStrict(TON, 'k')).toBe(2.5);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-API-Key': 'k' });
    await fetchTonBalanceStrict(TON);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });

  it('toncenter non-2xx throws (so the caller can fall back instead of showing 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(fetchTonBalanceStrict(TON)).rejects.toThrow();
  });

  it('TronGrid: one request for TRX + USDT, key header passed through', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ balance: 12_500_000, trc20: [{ [USDT_TRC20]: '3000000' }] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTronAccountBalances(TRON, { 'TRON-PRO-API-KEY': 'k' })).toEqual({ trx: 12.5, usdtTrc: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'TRON-PRO-API-KEY': 'k' });
  });

  it('unactivated TRON account parses as zeros', () => {
    expect(parseTronAccount({ data: [] })).toEqual({ trx: 0, usdtTrc: 0 });
  });
});
