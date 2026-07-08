import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/notifications/emit';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { writeNotification } from '@/lib/server/notifications';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getTraceId: vi.fn(() => null),
}));
vi.mock('@/lib/server/notifications', () => ({ writeNotification: vi.fn() }));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedWrite = vi.mocked(writeNotification);
const USER = { user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('POST /api/notifications/emit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 without a valid JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('429 when rate limited', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent' } }), res);
    expect(res.statusCode).toBe(429);
  });

  it('400 on a non-allowlisted kind (no arbitrary notifications)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'weekly_recap' } }), res);
    expect(res.statusCode).toBe(400);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('writes a tx_sent notification with only a validated coin (no free text)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent', coin: 'BTC', lang: 'en' } }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedWrite).toHaveBeenCalledWith('u1', 'tx_sent', 'en', { coin: 'BTC' }, undefined);
  });

  it('drops an invalid coin (e.g. a label with spaces/hyphens)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent', coin: 'USDT ERC-20' } }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedWrite).toHaveBeenCalledWith('u1', 'tx_sent', 'ru', {}, undefined);
  });
});
