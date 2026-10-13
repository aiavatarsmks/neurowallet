import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import handler from '@/pages/api/tg-auth';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const sb = vi.hoisted(() => ({
  session: {
    access_token: 'jwt-access',
    refresh_token: 'jwt-refresh',
    user: { id: 'user-1', email: 'tg_42@neurowallet.tg', app_metadata: {} as Record<string, unknown> },
  },
  updateUserById: vi.fn(),
  createClientArgs: [] as unknown[][],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((...args: unknown[]) => {
    sb.createClientArgs.push(args);
    return {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { session: sb.session }, error: null }),
        signUp: vi.fn().mockResolvedValue({ data: { session: sb.session }, error: null }),
        admin: { updateUserById: sb.updateUserById },
      },
      from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }) })),
    };
  }),
}));

const BOT_TOKEN = '12345:TEST_BOT_TOKEN';

/** Builds initData signed exactly the way Telegram does. */
function signedInitData(authDateSecondsAgo: number, tamper = false): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - authDateSecondsAgo),
    query_id: 'AAAtest',
    user: JSON.stringify({ id: 42, first_name: 'Test', username: 'testuser' }),
  });
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  let hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (tamper) hash = hash.replace(/^./, hash[0] === 'a' ? 'b' : 'a');
  params.set('hash', hash);
  return params.toString();
}

function authReq(initData: string) {
  return mockReq({ method: 'POST', body: { initData } });
}

describe('POST /api/tg-auth (initData validation)', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    sb.session.user.app_metadata = {};
    sb.updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
    sb.createClientArgs.length = 0;
  });

  it('accepts fresh, correctly signed initData and returns a session', async () => {
    const res = mockRes();
    await handler(authReq(signedInitData(60)), res);
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { access_token: string; user: { telegram_id: number } };
    expect(body.access_token).toBe('jwt-access');
    expect(body.user.telegram_id).toBe(42);
  });

  it('rejects a tampered HMAC signature with 401', async () => {
    const res = mockRes();
    await handler(authReq(signedInitData(60, true)), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects stale initData (auth_date older than 15 min) with 401', async () => {
    const res = mockRes();
    await handler(authReq(signedInitData(16 * 60)), res); // 16 minutes old
    expect(res.statusCode).toBe(401);
  });

  it('accepts initData just inside the freshness window', async () => {
    const res = mockRes();
    await handler(authReq(signedInitData(14 * 60)), res); // 14 minutes old
    expect(res.statusCode).toBe(200);
  });

  it('rejects a missing initData body with 400', async () => {
    const res = mockRes();
    await handler(authReq(''), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/tg-auth (verified app_metadata.telegram_id)', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    sb.session.user.app_metadata = { provider: 'email' };
    sb.updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
    sb.createClientArgs.length = 0;
  });

  it('writes app_metadata.telegram_id + source with the service role after the HMAC check', async () => {
    const res = mockRes();
    await handler(authReq(signedInitData(60)), res);
    expect(res.statusCode).toBe(200);
    expect(sb.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { telegram_id: 42, source: 'telegram_mini_app' },
    });
    // the admin client is built with the service key, never the anon key
    expect(sb.createClientArgs.some((a) => a[1] === 'service-test')).toBe(true);
  });

  it('does not touch app_metadata on a tampered initData', async () => {
    const res = mockRes();
    await handler(authReq(signedInitData(60, true)), res);
    expect(res.statusCode).toBe(401);
    expect(sb.updateUserById).not.toHaveBeenCalled();
  });

  it('skips the admin write when app_metadata already holds the same id', async () => {
    sb.session.user.app_metadata = { provider: 'email', telegram_id: 42, source: 'telegram_mini_app' };
    const res = mockRes();
    await handler(authReq(signedInitData(60)), res);
    expect(res.statusCode).toBe(200);
    expect(sb.updateUserById).not.toHaveBeenCalled();
  });

  it('login still succeeds when the admin write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sb.updateUserById.mockRejectedValue(new Error('gotrue down'));
    const res = mockRes();
    await handler(authReq(signedInitData(60)), res);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { access_token: string }).access_token).toBe('jwt-access');
    warn.mockRestore();
  });

  it('login still succeeds without SUPABASE_SERVICE_ROLE_KEY (no admin call)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = mockRes();
    await handler(authReq(signedInitData(60)), res);
    expect(res.statusCode).toBe(200);
    expect(sb.updateUserById).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
