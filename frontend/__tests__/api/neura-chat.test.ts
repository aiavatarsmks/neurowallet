import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/neura-chat';
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

const USER = { user: { id: 'user-1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

function chatReq() {
  return mockReq({
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'привет' }] },
  });
}

describe('POST /api/neura-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockReturnValue(true);
  });

  it('returns 401 without a valid Supabase JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(chatReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 429 when the per-user rate limit is exceeded', async () => {
    mockedLimit.mockReturnValue(false);
    const res = mockRes();
    await handler(chatReq(), res);
    expect(res.statusCode).toBe(429);
    expect(mockedLimit).toHaveBeenCalledWith('neura-chat:user-1', 20);
  });

  it('proxies to OpenRouter and writes audit log entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ответ Нейры' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await handler(chatReq(), res);

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { reply: string }).reply).toBe('ответ Нейры');

    const actions = mockedAudit.mock.calls.map((c) => c[1]);
    expect(actions).toContain('ai_chat_requested');
    expect(actions).toContain('ai_chat_completed');

    // The upstream request must never contain key material beyond the server env key.
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-key');
    vi.unstubAllGlobals();
  });

  it('returns 400 when there are no messages', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { messages: [] } }), res);
    expect(res.statusCode).toBe(400);
  });
});
