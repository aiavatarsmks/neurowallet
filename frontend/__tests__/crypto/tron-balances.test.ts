// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fetchTrxBalance, fetchUsdtTrc20Balance, fetchTronAccountBalances, parseTronAccount } from '@/lib/crypto/tron-tx';
import handler from '@/pages/api/balances';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { mockReq, mockRes } from '../api/helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/crypto/ton-tx', () => ({
  fetchTonBalanceStrict: vi.fn(),
  fetchUsdtTonBalanceStrict: vi.fn(),
}));

const ADDR = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function respond(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRONGRID_API_KEY;
});

describe('TRON balance fetchers: provider failure throws, empty account is 0', () => {
  it('activated account: TRX and USDT parsed from one response', async () => {
    vi.stubGlobal('fetch', respond({ success: true, data: [{ balance: 12_500_000, trc20: [{ [USDT]: '3000000' }] }] }));
    expect(await fetchTrxBalance(ADDR)).toBe(12.5);
    expect(await fetchUsdtTrc20Balance(ADDR)).toBe(3);
  });

  it('non-activated account (data: []) is a genuine 0, not an error', async () => {
    vi.stubGlobal('fetch', respond({ success: true, data: [], meta: { page_size: 0 } }));
    expect(await fetchTrxBalance(ADDR)).toBe(0);
    expect(await fetchUsdtTrc20Balance(ADDR)).toBe(0);
  });

  it('activated account without USDT or with zero TRX is 0', async () => {
    vi.stubGlobal('fetch', respond({ data: [{ trc20: [{ TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf: '5' }] }] }));
    expect(await fetchTrxBalance(ADDR)).toBe(0);
    expect(await fetchUsdtTrc20Balance(ADDR)).toBe(0);
  });

  it('network error throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchTrxBalance(ADDR)).rejects.toThrow();
    await expect(fetchUsdtTrc20Balance(ADDR)).rejects.toThrow();
  });

  it('non-2xx throws', async () => {
    vi.stubGlobal('fetch', respond({}, { ok: false, status: 429 }));
    await expect(fetchTrxBalance(ADDR)).rejects.toThrow('429');
    await expect(fetchUsdtTrc20Balance(ADDR)).rejects.toThrow('429');
  });

  it('malformed JSON throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); },
    }));
    await expect(fetchTrxBalance(ADDR)).rejects.toThrow();
  });

  it('API error field throws', async () => {
    vi.stubGlobal('fetch', respond({ success: false, error: 'rate limit exceeded', statusCode: 403 }));
    await expect(fetchTrxBalance(ADDR)).rejects.toThrow('rate limit');
    vi.stubGlobal('fetch', respond({ data: [], error: 'something' }));
    await expect(fetchUsdtTrc20Balance(ADDR)).rejects.toThrow();
  });

  it.each([
    ['null body', null],
    ['no data field', { success: true }],
    ['data not an array', { data: {} }],
    ['balance not a number', { data: [{ balance: '12' }] }],
    ['trc20 not an array', { data: [{ balance: 1, trc20: 'x' }] }],
    ['USDT amount not numeric', { data: [{ balance: 1, trc20: [{ [USDT]: 'abc' }] }] }],
  ])('unexpected shape (%s) throws instead of returning 0', async (_label, body) => {
    vi.stubGlobal('fetch', respond(body));
    await expect(fetchTronAccountBalances(ADDR)).rejects.toThrow();
    expect(() => parseTronAccount(body)).toThrow();
  });

  it('no address → 0 without a network call (nothing to fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTrxBalance('')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/balances with the real TRON fetcher', () => {
  beforeEach(() => {
    vi.mocked(requireSupabaseUser).mockResolvedValue({ user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>);
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    process.env.TRONGRID_API_KEY = 'tron-secret';
  });

  it('TronGrid error body → trx/usdtTrc null (client falls back), never 0', async () => {
    vi.stubGlobal('fetch', respond({ success: false, error: 'boom' }));
    const res = mockRes();
    await handler(mockReq({ query: { tron: ADDR } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ trx: null, usdtTrc: null });
  });

  it('non-activated account → 0 (a real zero passes through)', async () => {
    vi.stubGlobal('fetch', respond({ success: true, data: [] }));
    const res = mockRes();
    await handler(mockReq({ query: { tron: ADDR } }), res);
    expect(res.jsonBody).toMatchObject({ trx: 0, usdtTrc: 0 });
  });
});
