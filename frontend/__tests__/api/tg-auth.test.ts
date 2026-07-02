import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import handler from '@/pages/api/tg-auth';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const SESSION = {
  access_token: 'jwt-access',
  refresh_token: 'jwt-refresh',
  user: { id: 'user-1', email: 'tg_42@neurowallet.tg' },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
    },
    from: vi.fn(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }) })),
  })),
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
