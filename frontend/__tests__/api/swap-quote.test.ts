import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/swap/quote';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const USER = { user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('/api/swap/quote — hard-gated, read-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SWAP_ENABLED = 'true';
    process.env.ONEINCH_API_KEY = 'test-key';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('405 on non-POST', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('503 when the feature flag is off (inert)', async () => {
    process.env.NEXT_PUBLIC_SWAP_ENABLED = '';
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(503);
  });

  it('401 without a valid JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('429 when rate limited', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(429);
  });

  it('503 when no router API key is configured', async () => {
    process.env.ONEINCH_API_KEY = '';
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { fromCoin: 'ETH', toCoin: 'TON', amount: '1000' } }), res);
    expect(res.statusCode).toBe(503);
  });

  it('400 on an unsupported / same-coin pair', async () => {
    const res1 = mockRes();
    await handler(mockReq({ method: 'POST', body: { fromCoin: 'BTC', toCoin: 'TON', amount: '1000' } }), res1);
    expect(res1.statusCode).toBe(400);
    const res2 = mockRes();
    await handler(mockReq({ method: 'POST', body: { fromCoin: 'ETH', toCoin: 'ETH', amount: '1000' } }), res2);
    expect(res2.statusCode).toBe(400);
  });

  it('400 on a bad amount', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { fromCoin: 'ETH', toCoin: 'TON', amount: '0' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('gates pass → quote_unavailable while the router adapter is a stub (no execution)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { fromCoin: 'ETH', toCoin: 'TON', amount: '1000000' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { error: string }).error).toBe('quote_unavailable');
  });
});
