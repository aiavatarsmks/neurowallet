import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/notifications/recap';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { generateWeeklyRecap } from '@/lib/server/recap';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/server/recap', () => ({
  generateWeeklyRecap: vi.fn(),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedGen = vi.mocked(generateWeeklyRecap);
const USER = { user: { id: 'u1', user_metadata: {} }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('/api/notifications/recap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_WEEKLY_RECAP_ENABLED = 'true';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
    mockedGen.mockResolvedValue({ status: 'sent', counts: { sends: 1, risksFlagged: 0, claimsSent: 0, claimsReceived: 0, aiUsed: 0 } });
  });

  it('405 on non-POST', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('403 when the recap flag is off (inert)', async () => {
    process.env.NEXT_PUBLIC_WEEKLY_RECAP_ENABLED = '';
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(403);
    expect(mockedGen).not.toHaveBeenCalled();
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
    expect(mockedGen).not.toHaveBeenCalled();
  });

  it('200 returns the generator status', async () => {
    mockedGen.mockResolvedValue({ status: 'deduped', counts: { sends: 0, risksFlagged: 0, claimsSent: 0, claimsReceived: 0, aiUsed: 0 } });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { lang: 'en' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { status: string }).status).toBe('deduped');
    expect(mockedGen).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', lang: 'en' }));
  });
});
