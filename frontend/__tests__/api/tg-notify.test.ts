import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/tg-notify';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(writeAuditLog);

function authUser(telegramId?: number) {
  return {
    user: { id: 'user-1', user_metadata: telegramId ? { telegram_id: telegramId } : {} },
    token: 'jwt',
  } as Awaited<ReturnType<typeof requireSupabaseUser>>;
}

describe('POST /api/tg-notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    mockedAuth.mockResolvedValue(authUser(42));
    mockedLimit.mockReturnValue(true);
  });

  it('returns 401 without a valid Supabase JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { message: 'hi' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 429 when the per-user rate limit is exceeded', async () => {
    mockedLimit.mockReturnValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { message: 'hi' } }), res);
    expect(res.statusCode).toBe(429);
  });

  it('returns 403 when the account has no linked telegram_id', async () => {
    mockedAuth.mockResolvedValue(authUser(undefined));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { message: 'hi' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('sends only to the session telegram_id, ignoring any body telegramId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await handler(
      mockReq({ method: 'POST', body: { message: 'hi', telegramId: 999999 } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    expect(sent.chat_id).toBe(42); // from session metadata, NOT 999999 from body

    const actions = mockedAudit.mock.calls.map((c) => c[1]);
    expect(actions).toContain('telegram_notification_requested');
    expect(actions).toContain('telegram_notification_sent');
    vi.unstubAllGlobals();
  });
});
