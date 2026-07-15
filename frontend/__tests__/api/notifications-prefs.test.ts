import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/notifications/prefs';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
}));

let dbRow: Record<string, unknown> | null = null;
const upserts: Record<string, unknown>[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: dbRow }); },
        upsert(row: Record<string, unknown>) { upserts.push(row); return Promise.resolve({ error: null }); },
      };
    },
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const USER = { user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('/api/notifications/prefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbRow = null;
    upserts.length = 0;
    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED = 'true';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('403 when the engine flag is off (inert)', async () => {
    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED = '';
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(403);
  });

  it('401 without a valid JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('GET returns safe defaults when there is no row', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as Record<string, unknown>;
    expect(body.telegram_enabled).toBe(false);
    expect(body.transactional_enabled).toBe(true);
    expect(body.security_enabled).toBe(true);
  });

  it('POST upserts validated prefs (clamps out-of-range, security stays on)', async () => {
    const res = mockRes();
    await handler(
      mockReq({
        method: 'POST',
        body: { telegram_enabled: true, security_enabled: false, quiet_hours_enabled: true, quiet_start_min: 9999, tz_offset_min: 5000 },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(upserts).toHaveLength(1);
    const row = upserts[0];
    expect(row.telegram_enabled).toBe(true);
    expect(row.security_enabled).toBe(true); // never silenced
    expect(row.quiet_start_min).toBe(1320); // invalid → default
    expect(row.tz_offset_min).toBe(0); // invalid → default
    expect(row.user_id).toBe('u1');
  });
});
