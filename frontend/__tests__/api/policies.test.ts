import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/policies';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn(),
}));

const inserts: Record<string, unknown>[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const chain = {
        select() { return chain; },
        order() { return chain; },
        eq() { return chain; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        insert(row: Record<string, unknown>) { inserts.push(row); return chain; },
        single() { return Promise.resolve({ data: { id: 'new-id' }, error: null }); },
      };
      return chain;
    },
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const USER = { user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('/api/policies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    process.env.NEXT_PUBLIC_POLICY_ENGINE_ENABLED = 'true';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('503 when the engine flag is off (inert)', async () => {
    process.env.NEXT_PUBLIC_POLICY_ENGINE_ENABLED = '';
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(503);
  });

  it('401 without a JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('no'));
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('GET returns the policy list', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ policies: [] });
  });

  it('POST 400 on unknown type', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { type: 'nope', rule: {} } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('POST 400 on an invalid rule (missing amount)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { type: 'max_amount_per_tx', rule: {} } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('POST 201 creates a valid limit policy (normalised)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { type: 'max_amount_per_tx', rule: { maxAmount: '100000000', asset: 'TON', junk: 'x' } } }), res);
    expect(res.statusCode).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ user_id: 'u1', type: 'max_amount_per_tx' });
    expect(inserts[0].rule).toEqual({ maxAmount: '100000000', asset: 'TON' }); // junk stripped
  });

  it('PATCH 400 without a boolean enabled', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: '11111111-1111-1111-1111-111111111111' } }), res);
    expect(res.statusCode).toBe(400);
  });
});
