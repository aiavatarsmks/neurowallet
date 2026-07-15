import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/claim/complete';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { completeClaim } from '@/lib/server/claim';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/server/claim', () => ({ completeClaim: vi.fn() }));

const mAuth = vi.mocked(requireSupabaseUser);
const mLimit = vi.mocked(checkRateLimit);
const mComplete = vi.mocked(completeClaim);
const USER = { user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const REF = '00000000-0000-0000-0000-0000000000aa';

describe('POST /api/claim/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CLAIM_LINKS_ENABLED = 'true';
    mAuth.mockResolvedValue(USER);
    mLimit.mockResolvedValue(true);
    mComplete.mockResolvedValue({ ok: true, asset: 'USDT_TON', network: 'ton', amount: 5, isDemo: true, senderUserId: null });
  });

  it('403 when the flag is off', async () => {
    process.env.NEXT_PUBLIC_CLAIM_LINKS_ENABLED = 'false';
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ref: REF, secret: 's' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('401 without a valid session (recipient must be onboarded)', async () => {
    mAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ref: REF, secret: 's' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('403 bad_secret when the secret does not match', async () => {
    mComplete.mockResolvedValue({ error: 'bad_secret' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ref: REF, secret: 'wrong' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('409 when already claimed (no double-claim)', async () => {
    mComplete.mockResolvedValue({ error: 'already_claimed' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ref: REF, secret: 's' } }), res);
    expect(res.statusCode).toBe(409);
  });

  it('410 when expired', async () => {
    mComplete.mockResolvedValue({ error: 'expired' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ref: REF, secret: 's' } }), res);
    expect(res.statusCode).toBe(410);
  });

  it('200 on a successful demo claim (no chain action)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ref: REF, secret: 's' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { ok: boolean; amount: number }).amount).toBe(5);
    expect(mComplete).toHaveBeenCalledWith(REF, 's', 'u1', null);
  });
});
