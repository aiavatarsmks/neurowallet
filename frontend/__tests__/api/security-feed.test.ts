import { describe, it, expect, beforeEach, vi } from 'vitest';
import feedHandler, { FEED_ACTIONS } from '@/pages/api/security-feed';
import pingHandler from '@/pages/api/device-ping';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  auditRows: [] as Array<Record<string, unknown>>,
  deviceUpserts: [] as Array<Record<string, unknown>>,
  query: { eq: [] as unknown[], in: [] as unknown[], limit: 0 },
  upsertError: null as null | { message: string },
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (...eqArgs: unknown[]) => {
          state.query.eq = eqArgs;
          return {
            in: (...inArgs: unknown[]) => {
              state.query.in = inArgs;
              return {
                order: () => ({
                  limit: (n: number) => {
                    state.query.limit = n;
                    return Promise.resolve({ data: state.auditRows, error: null });
                  },
                }),
              };
            },
          };
        },
      }),
      upsert: (row: Record<string, unknown>) => {
        state.deviceUpserts.push(row);
        return Promise.resolve({ error: state.upsertError });
      },
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);
type AuthResult = Awaited<ReturnType<typeof requireSupabaseUser>>;
const USER = { user: { id: 'user-1', email: 'alice@example.com', app_metadata: { provider: 'email' } }, token: 'jwt' } as unknown as AuthResult;

describe('security center endpoints (task 1.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auditRows = [];
    state.deviceUpserts.length = 0;
    state.query = { eq: [], in: [], limit: 0 };
    state.upsertError = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('security-feed requires auth', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await feedHandler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('security-feed filters by action IN THE QUERY (noisy actions cannot push logins out)', async () => {
    const res = mockRes();
    await feedHandler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect(state.query.eq).toEqual(['user_id', 'user-1']);
    expect(state.query.in[0]).toBe('action');
    const actions = state.query.in[1] as string[];
    expect(actions).toEqual([...FEED_ACTIONS]);
    expect(actions).toContain('tg_auth_login');
    expect(actions).toContain('session_started');
    expect(actions).not.toContain('tx_history_requested');
    expect(actions.some((a) => a.startsWith('ai_chat_'))).toBe(false);
    expect(state.query.limit).toBe(30);
  });

  it('security-feed filters actions by allowlist and metadata by safe keys', async () => {
    state.auditRows = [
      { action: 'risk_flagged', created_at: '2026-07-03T01:00:00Z', metadata: { coin: 'ETH', level: 'block', trace_id: 'x', draft_id: 'secret' } },
      { action: 'ai_chat_requested', created_at: '2026-07-03T01:01:00Z', metadata: {} }, // не в allowlist
      { action: 'tg_auth_login', created_at: '2026-07-03T01:02:00Z', metadata: { telegram_id: 42 } },
      { action: 'session_started', created_at: '2026-07-03T01:03:00Z', metadata: { method: 'email' } },
    ];
    const res = mockRes();
    await feedHandler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    const events = (res.jsonBody as { events: Array<{ action: string; meta: Record<string, unknown> }> }).events;
    expect(events.map((e) => e.action)).toEqual(['risk_flagged', 'tg_auth_login', 'session_started']);
    // trace_id/draft_id/telegram_id вычищены, coin/level остались
    expect(events[0].meta).toEqual({ coin: 'ETH', level: 'block' });
    expect(events[1].meta).toEqual({});
    expect(events[2].meta).toEqual({ method: 'email' });
  });

  it('device-ping hashes the user-agent server-side and stores a truncated label', async () => {
    const ua = 'Mozilla/5.0 (iPhone; Telegram) ' + 'x'.repeat(200);
    const res = mockRes();
    await pingHandler(mockReq({ method: 'POST', headers: { 'user-agent': ua } }), res);
    expect(res.statusCode).toBe(204);
    const row = state.deviceUpserts[0];
    expect(row.user_id).toBe('user-1');
    expect(String(row.ua_hash)).toMatch(/^[0-9a-f]{32}$/);
    expect(String(row.ua_label).length).toBeLessThanOrEqual(96);
  });

  it('device-ping requires auth', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await pingHandler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('device-ping audits session_started for email sessions (even before migration 0007)', async () => {
    state.upsertError = { message: 'relation "devices" does not exist' };
    const res = mockRes();
    await pingHandler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedAudit).toHaveBeenCalledWith('user-1', 'session_started', { method: 'email' }, expect.anything());
  });

  it('device-ping does not double-audit Telegram accounts (tg-auth already writes tg_auth_login)', async () => {
    for (const user of [
      { id: 'user-1', email: 'tg_42@neurowallet.tg', app_metadata: { provider: 'email' } },
      { id: 'user-1', email: 'x@example.com', app_metadata: { telegram_id: 42, source: 'telegram_mini_app' } },
    ]) {
      mockedAudit.mockClear();
      mockedAuth.mockResolvedValue({ user, token: 'jwt' } as unknown as AuthResult);
      const res = mockRes();
      await pingHandler(mockReq({ method: 'POST' }), res);
      expect(res.statusCode).toBe(204);
      expect(mockedAudit).not.toHaveBeenCalled();
    }
  });
});
