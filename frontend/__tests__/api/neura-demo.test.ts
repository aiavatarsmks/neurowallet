import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/neura-demo';
import { checkRateLimit } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

// Keep getClientIp real (reads the mockReq socket), stub only the limiter.
vi.mock('@/lib/server/api-security', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/api-security')>()),
  checkRateLimit: vi.fn(),
}));

const mockedLimit = vi.mocked(checkRateLimit);

function demoReq(body?: unknown) {
  return mockReq({
    method: 'POST',
    body: body ?? { messages: [{ role: 'user', content: 'привет' }], lang: 'ru' },
  });
}

describe('POST /api/neura-demo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockedLimit.mockResolvedValue(true);
  });

  it('serves without a JWT but rate-limits per IP', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(demoReq(), res);
    expect(res.statusCode).toBe(429);
    expect(mockedLimit).toHaveBeenCalledWith('neura-demo:127.0.0.1', 8);
  });

  it('uses the demo prompt, caps tokens, and forwards NO wallet context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Привет! Я Нейра.' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Even if a client tries to smuggle walletContext, it must be ignored.
    const res = mockRes();
    await handler(
      demoReq({ messages: [{ role: 'user', content: 'что ты умеешь' }], lang: 'ru', walletContext: { eth: 5 } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { reply: string }).reply).toBe('Привет! Я Нейра.');

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).toMatch(/демо-режим/i);
    expect(sent.max_tokens).toBe(300);
    // No wallet data leaks into the forwarded payload.
    expect(init.body).not.toContain('walletContext');
    expect(init.body).not.toContain('"eth"');
    vi.unstubAllGlobals();
  });

  it('returns 400 when there are no messages', async () => {
    const res = mockRes();
    await handler(demoReq({ messages: [], lang: 'ru' }), res);
    expect(res.statusCode).toBe(400);
  });
});
