import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/claim/create';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { createClaim } from '@/lib/server/claim';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '1.2.3.4'),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/server/claim', () => ({ createClaim: vi.fn() }));

const mAuth = vi.mocked(requireSupabaseUser);
const mLimit = vi.mocked(checkRateLimit);
const mCreate = vi.mocked(createClaim);
const SID = '00000000-0000-0000-0000-000000000001';

const body = (over: Record<string, unknown> = {}) => ({
  asset: 'USDT_TON', network: 'ton', amount: 5, secret_hash: 'a'.repeat(64),
  dedupe_key: 'dedupe-12345', is_demo: true, session_id: SID, ...over,
});

describe('POST /api/claim/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CLAIM_LINKS_ENABLED = 'true';
    mAuth.mockRejectedValue(new Error('anon')); // demo sender: no auth session
    mLimit.mockResolvedValue(true);
    mCreate.mockResolvedValue({ id: 'ref-1', expiresAt: '2026-07-21T00:00:00Z' });
  });

  it('403 when the feature flag is off', async () => {
    process.env.NEXT_PUBLIC_CLAIM_LINKS_ENABLED = 'false';
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: body() }), res);
    expect(res.statusCode).toBe(403);
  });

  it('400 demo_only when is_demo !== true (real money is v2+)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: body({ is_demo: false }) }), res);
    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { error: string }).error).toBe('demo_only');
    expect(mCreate).not.toHaveBeenCalled();
  });

  it('400 on a non-TON asset (TON-first)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: body({ asset: 'BTC' }) }), res);
    expect(res.statusCode).toBe(400);
    expect(mCreate).not.toHaveBeenCalled();
  });

  it('creates a claim for an anonymous demo sender and returns a ref', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: body() }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { ref: string }).ref).toBe('ref-1');
    expect(mCreate).toHaveBeenCalledWith(
      expect.objectContaining({ senderUserId: null, senderSessionId: SID, isDemo: true, asset: 'USDT_TON' }),
    );
  });

  it('429 when the sender hit an active/daily limit', async () => {
    mCreate.mockResolvedValue({ error: 'too_many_active' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: body() }), res);
    expect(res.statusCode).toBe(429);
  });
});
