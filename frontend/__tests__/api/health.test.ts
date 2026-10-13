import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '@/pages/api/health';
import { checkRateLimit } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

// Keep getClientIp real (reads the mockReq socket), stub the limiter.
vi.mock('@/lib/server/api-security', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/api-security')>()),
  checkRateLimit: vi.fn(),
}));

const mockedLimit = vi.mocked(checkRateLimit);

type Health = {
  ok: boolean;
  time: string;
  checks: { supabase: string; rateLimitStore: string; auditLog: string };
};

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

describe('GET /api/health', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co/';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-SECRET-ish';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    mockedLimit.mockResolvedValue(true);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('200 ok with an anon PostgREST ping; no-store; minimal config flags', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect((res as unknown as { headers: Record<string, string> }).headers['Cache-Control']).toBe('no-store');
    const body = res.jsonBody as Health;
    expect(body.ok).toBe(true);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(body.checks).toEqual({ supabase: 'ok', rateLimitStore: 'memory', auditLog: 'off' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/rest/v1/profiles?select=id&limit=1');
    expect(init.headers.apikey).toBe('anon-SECRET-ish');
    expect(init.signal).toBeDefined();
  });

  it('reports durable rate limit store and audit on, without echoing any env value', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example/SECRET_URL';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'UPSTASH_SECRET_TOKEN';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'SERVICE_ROLE_SECRET';
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    const body = res.jsonBody as Health;
    expect(body.checks).toEqual({ supabase: 'ok', rateLimitStore: 'durable', auditLog: 'on' });
    const raw = JSON.stringify(body);
    for (const secret of ['SECRET_URL', 'UPSTASH_SECRET_TOKEN', 'SERVICE_ROLE_SECRET', 'anon-SECRET-ish', 'proj.supabase.co']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('503 ok:false when Supabase answers non-2xx or the request throws', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    let res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(503);
    expect((res.jsonBody as Health).ok).toBe(false);
    expect((res.jsonBody as Health).checks.supabase).toBe('fail');

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(503);
  });

  it('gives up on Supabase after 2 s (abort) and reports fail', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    const res = mockRes();
    const pending = handler(mockReq({ method: 'GET' }), res);
    await vi.advanceTimersByTimeAsync(1999);
    expect(res.statusCode).toBe(0); // still waiting
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(res.statusCode).toBe(503);
    expect((res.jsonBody as Health).checks.supabase).toBe('fail');
  });

  it('fail without calling out when Supabase env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limited per IP → 429 (still no-store)', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(429);
    expect(mockedLimit).toHaveBeenCalledWith('health:127.0.0.1', 30);
    expect((res as unknown as { headers: Record<string, string> }).headers['Cache-Control']).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('405 on non-GET', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });
});
