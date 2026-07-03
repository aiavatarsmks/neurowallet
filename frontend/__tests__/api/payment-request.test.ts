import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/payment-request';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updateReturns: [{ id: 'req-1' }] as Array<Record<string, unknown>>,
  resolveRow: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        if (table === 'payment_requests') {
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'req-1' }, error: null }) }) };
        }
        return Promise.resolve({ error: null });
      },
      update: (row: Record<string, unknown>) => {
        state.updates.push({ table, row });
        return {
          eq: () => ({
            eq: () => {
              const result = Promise.resolve({ data: state.updateReturns, error: null });
              return Object.assign(result, { select: () => Promise.resolve({ data: state.updateReturns, error: null }) });
            },
          }),
        };
      },
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.resolveRow, error: null }) }),
      }),
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const REQ_UUID = '123e4567-e89b-42d3-a456-426614174000';
const CREATE_BODY = { coin: 'TON', address: 'EQA2qqtv2MASYNxCAjSB740ly2JELsh56uWl1rBeH4jWIs5v', amount: 5 };

describe('/api/payment-request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.inserts.length = 0;
    state.updates.length = 0;
    state.updateReturns = [{ id: 'req-1' }];
    state.resolveRow = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('POST requires auth and validates payload', async () => {
    mockedAuth.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: CREATE_BODY }), res);
    expect(res.statusCode).toBe(401);

    for (const bad of [{ ...CREATE_BODY, coin: 'DOGE' }, { ...CREATE_BODY, amount: -5 }, { ...CREATE_BODY, address: '' }]) {
      const r = mockRes();
      await handler(mockReq({ method: 'POST', body: bad }), r);
      expect(r.statusCode).toBe(400);
    }
  });

  it('POST creates a request, clamps expiry to 7 days, returns canonical url', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { ...CREATE_BODY, expires_hours: 10_000 } }), res);
    expect(res.statusCode).toBe(201);
    expect((res.jsonBody as { url: string }).url).toBe(`https://neurowallet.tech/pay/req-1`);

    const row = state.inserts.find((i) => i.table === 'payment_requests')!.row;
    const hours = (new Date(row.expires_at as string).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeLessThanOrEqual(168.1);
    expect(hours).toBeGreaterThan(167);

    expect(state.inserts.some((i) => i.table === 'payment_events' && i.row.event === 'created')).toBe(true);
    const auditMeta = mockedAudit.mock.calls[0][2] as Record<string, unknown>;
    expect(JSON.stringify(auditMeta)).not.toContain(CREATE_BODY.address);
  });

  it('GET resolves an active request and records viewed', async () => {
    state.resolveRow = {
      id: REQ_UUID, coin: 'TON', amount: 5, address: CREATE_BODY.address,
      status: 'active', expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { id: REQ_UUID } }), res);
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as Record<string, unknown>;
    expect(body.status).toBe('active');
    expect(body.address).toBe(CREATE_BODY.address);
    expect(state.inserts.some((i) => i.table === 'payment_events' && i.row.event === 'viewed')).toBe(true);
  });

  it('GET lazily expires an overdue request (acceptance: истекает корректно)', async () => {
    state.resolveRow = {
      id: REQ_UUID, coin: 'TON', amount: 5, address: CREATE_BODY.address,
      status: 'active', expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { id: REQ_UUID } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { status: string }).status).toBe('expired');
    expect(state.updates.some((u) => u.table === 'payment_requests' && u.row.status === 'expired')).toBe(true);
    expect(state.inserts.some((i) => i.table === 'payment_events' && i.row.event === 'expired')).toBe(true);
    // адрес наружу при протухшей ссылке не отдаётся
    expect((res.jsonBody as Record<string, unknown>).address).toBeUndefined();
  });

  it('GET returns 404 for unknown ids and 400 for malformed', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { id: REQ_UUID } }), res);
    expect(res.statusCode).toBe(404);

    const res2 = mockRes();
    await handler(mockReq({ method: 'GET', query: { id: 'garbage' } }), res2);
    expect(res2.statusCode).toBe(400);
  });

  it('PATCH completes own active request; 404 otherwise', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: REQ_UUID, status: 'completed' } }), res);
    expect(res.statusCode).toBe(200);

    state.updateReturns = [];
    const res2 = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: REQ_UUID, status: 'cancelled' } }), res2);
    expect(res2.statusCode).toBe(404);
  });
});
