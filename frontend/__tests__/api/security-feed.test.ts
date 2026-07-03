import { describe, it, expect, beforeEach, vi } from 'vitest';
import feedHandler from '@/pages/api/security-feed';
import pingHandler from '@/pages/api/device-ping';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const state = vi.hoisted(() => ({
  auditRows: [] as Array<Record<string, unknown>>,
  deviceUpserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => Promise.resolve({ data: state.auditRows, error: null }) }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        state.deviceUpserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('security center endpoints (task 1.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auditRows = [];
    state.deviceUpserts.length = 0;
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

  it('security-feed filters actions by allowlist and metadata by safe keys', async () => {
    state.auditRows = [
      { action: 'risk_flagged', created_at: '2026-07-03T01:00:00Z', metadata: { coin: 'ETH', level: 'block', trace_id: 'x', draft_id: 'secret' } },
      { action: 'ai_chat_requested', created_at: '2026-07-03T01:01:00Z', metadata: {} }, // не в allowlist
      { action: 'tg_auth_login', created_at: '2026-07-03T01:02:00Z', metadata: { telegram_id: 42 } },
    ];
    const res = mockRes();
    await feedHandler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    const events = (res.jsonBody as { events: Array<{ action: string; meta: Record<string, unknown> }> }).events;
    expect(events.map((e) => e.action)).toEqual(['risk_flagged', 'tg_auth_login']);
    // trace_id/draft_id/telegram_id вычищены, coin/level остались
    expect(events[0].meta).toEqual({ coin: 'ETH', level: 'block' });
    expect(events[1].meta).toEqual({});
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
});
