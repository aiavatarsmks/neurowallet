import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/risk-event';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  riskInserts: [] as Array<Record<string, unknown>>,
  overrideInserts: [] as Array<Record<string, unknown>>,
  riskInsertError: null as { message: string } | null,
  overrideInsertError: null as { message: string } | null,
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
  getTraceId: () => null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === 'risk_events') {
          state.riskInserts.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  state.riskInsertError
                    ? { data: null, error: state.riskInsertError }
                    : { data: { id: 'risk-1' }, error: null },
                ),
            }),
          };
        }
        state.overrideInserts.push(row);
        return Promise.resolve({ error: state.overrideInsertError });
      },
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;
const RISK_BODY = {
  coin: 'ETH',
  level: 'block',
  reasons: [{ code: 'poisoning_similarity', level: 'block', similarTo: '0x71c765…8976f' }],
};
const EVENT_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('/api/risk-event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.riskInserts.length = 0;
    state.overrideInserts.length = 0;
    state.riskInsertError = null;
    state.overrideInsertError = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 / 429 guards', async () => {
    mockedAuth.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const res1 = mockRes();
    await handler(mockReq({ method: 'POST', body: RISK_BODY }), res1);
    expect(res1.statusCode).toBe(401);

    mockedLimit.mockResolvedValueOnce(false);
    const res2 = mockRes();
    await handler(mockReq({ method: 'POST', body: RISK_BODY }), res2);
    expect(res2.statusCode).toBe(429);
  });

  it('400 on bad coin/level/reason codes', async () => {
    for (const body of [
      { ...RISK_BODY, coin: 'DOGE' },
      { ...RISK_BODY, level: 'critical' },
      { ...RISK_BODY, reasons: [{ code: 'made_up' }] },
      { ...RISK_BODY, reasons: [] },
    ]) {
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body }), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it('POST stores sanitized reasons (codes only, no similarTo/addresses) and audits risk_flagged', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: RISK_BODY }), res);
    expect(res.statusCode).toBe(201);

    const stored = state.riskInserts[0].reasons as Array<Record<string, unknown>>;
    expect(stored).toEqual([{ code: 'poisoning_similarity', level: 'block' }]);
    expect(JSON.stringify(state.riskInserts[0])).not.toContain('0x71c765');

    expect(mockedAudit.mock.calls[0][1]).toBe('risk_flagged');
  });

  it('degrades to 200 {id:null} when the migration is not applied yet', async () => {
    state.riskInsertError = { message: 'relation "risk_events" does not exist' };
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: RISK_BODY }), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { id: null }).id).toBeNull();
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it('PATCH records the override and audits risk_override_confirmed', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: EVENT_UUID } }), res);
    expect(res.statusCode).toBe(200);
    expect(state.overrideInserts[0].risk_event_id).toBe(EVENT_UUID);
    expect(mockedAudit.mock.calls[0][1]).toBe('risk_override_confirmed');
  });

  it('PATCH on foreign/missing risk event → 404 (RLS/FK)', async () => {
    state.overrideInsertError = { message: 'violates row-level security' };
    const res = mockRes();
    await handler(mockReq({ method: 'PATCH', body: { id: EVENT_UUID } }), res);
    expect(res.statusCode).toBe(404);
  });
});
