import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/track';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

const inserts = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getTraceId: (req: { headers: Record<string, unknown> }) => {
    const v = req.headers['x-trace-id'];
    return typeof v === 'string' ? v : null;
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const TRACE_ID = '7f000001-aaaa-4bbb-8ccc-000000000001';

function trackReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return mockReq({ method: 'POST', body, headers });
}

describe('POST /api/track', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED')); // anonymous by default
    mockedLimit.mockResolvedValue(true);
  });

  it('rejects unknown event names with 400', async () => {
    const res = mockRes();
    await handler(trackReq({ event: 'totally_made_up', session_id: SESSION_ID }), res);
    expect(res.statusCode).toBe(400);
    expect(inserts.length).toBe(0);
  });

  it('rejects missing/invalid session_id with 400', async () => {
    const res = mockRes();
    await handler(trackReq({ event: 'demo_entered', session_id: 'not-a-uuid' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(trackReq({ event: 'demo_entered', session_id: SESSION_ID }), res);
    expect(res.statusCode).toBe(429);
  });

  it('accepts anonymous events with user_id=null and per-IP limit key', async () => {
    const res = mockRes();
    await handler(trackReq({ event: 'onboarding_started', session_id: SESSION_ID }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts[0].user_id).toBeNull();
    expect(inserts[0].event).toBe('onboarding_started');
    expect(String(mockedLimit.mock.calls[0][0])).toMatch(/^track:ip:/);
  });

  it('attributes authenticated events to the user with per-user limit key', async () => {
    mockedAuth.mockResolvedValue({ user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>);
    const res = mockRes();
    await handler(trackReq({ event: 'ai_chat_used', session_id: SESSION_ID, properties: { lang: 'ru' } }), res);
    expect(res.statusCode).toBe(204);
    expect(inserts[0].user_id).toBe('user-1');
    expect(mockedLimit).toHaveBeenCalledWith('track:user-1', 60);
  });

  it('strips non-allowlisted property keys (PII guard) and passes trace id', async () => {
    const res = mockRes();
    await handler(
      trackReq(
        {
          event: 'send_failed',
          session_id: SESSION_ID,
          properties: {
            coin: 'ETH',
            reason_code: 'x'.repeat(200),
            email: 'leak@example.com', // не в allowlist — должен исчезнуть
            address: '0xabc',          // не в allowlist — должен исчезнуть
          },
        },
        { 'x-trace-id': TRACE_ID },
      ),
      res,
    );
    expect(res.statusCode).toBe(204);
    const props = inserts[0].properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['coin', 'reason_code']);
    expect(String(props.reason_code).length).toBe(64); // усечение
    expect(inserts[0].trace_id).toBe(TRACE_ID);
  });
});
