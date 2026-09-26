import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '@/pages/api/balances';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { fetchTronAccountBalances } from '@/lib/crypto/tron-tx';
import { fetchTonBalanceStrict, fetchUsdtTonBalanceStrict } from '@/lib/crypto/ton-tx';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/crypto/tron-tx', () => ({ fetchTronAccountBalances: vi.fn() }));
vi.mock('@/lib/crypto/ton-tx', () => ({
  fetchTonBalanceStrict: vi.fn(),
  fetchUsdtTonBalanceStrict: vi.fn(),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedTron = vi.mocked(fetchTronAccountBalances);
const mockedTon = vi.mocked(fetchTonBalanceStrict);
const mockedUsdtTon = vi.mocked(fetchUsdtTonBalanceStrict);

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const TON = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('GET /api/balances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TONCENTER_API_KEY;
    delete process.env.TRONGRID_API_KEY;
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
    mockedTon.mockResolvedValue(1.5);
    mockedUsdtTon.mockResolvedValue(20);
    mockedTron.mockResolvedValue({ trx: 100, usdtTrc: 7 });
  });
  afterEach(() => {
    delete process.env.TONCENTER_API_KEY;
    delete process.env.TRONGRID_API_KEY;
  });

  it('returns 401 without a valid Supabase JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ query: { ton: TON } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 429 over the per-user rate limit', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ query: { ton: TON } }), res);
    expect(res.statusCode).toBe(429);
    expect(mockedLimit).toHaveBeenCalledWith('balances:user-1', 40);
  });

  it('rejects malformed addresses (path injection) with 400', async () => {
    const res = mockRes();
    await handler(mockReq({ query: { tron: `${TRON}/../../wallet/x` } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('without keys serves nothing (null) so the client keeps its direct keyless path', async () => {
    const res = mockRes();
    await handler(mockReq({ query: { ton: TON, tron: TRON } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ton: null, usdtTon: null, trx: null, usdtTrc: null });
    expect(mockedTon).not.toHaveBeenCalled();
    expect(mockedTron).not.toHaveBeenCalled();
  });

  it('with keys fetches via the provider with the key and never returns it', async () => {
    process.env.TONCENTER_API_KEY = 'ton-secret';
    process.env.TRONGRID_API_KEY = 'tron-secret';
    const res = mockRes();
    await handler(mockReq({ query: { ton: TON, tron: TRON } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ ton: 1.5, usdtTon: 20, trx: 100, usdtTrc: 7 });
    expect(mockedTon).toHaveBeenCalledWith(TON, 'ton-secret');
    expect(mockedUsdtTon).toHaveBeenCalledWith(TON, 'ton-secret');
    expect(mockedTron).toHaveBeenCalledWith(TRON, { 'TRON-PRO-API-KEY': 'tron-secret' });
    expect(JSON.stringify(res.jsonBody)).not.toMatch(/secret/);
  });

  it('per-chain provider failure → null (fallback), not a fake 0', async () => {
    process.env.TONCENTER_API_KEY = 'ton-secret';
    process.env.TRONGRID_API_KEY = 'tron-secret';
    mockedUsdtTon.mockRejectedValue(new Error('429'));
    mockedTron.mockRejectedValue(new Error('down'));
    const res = mockRes();
    await handler(mockReq({ query: { ton: TON, tron: TRON } }), res);
    expect(res.jsonBody).toEqual({ ton: 1.5, usdtTon: null, trx: null, usdtTrc: null });
  });
});
