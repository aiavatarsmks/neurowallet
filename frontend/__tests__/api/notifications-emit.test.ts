import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '@/pages/api/notifications/emit';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { writeNotification } from '@/lib/server/notifications';
import { dispatchNotification } from '@/lib/server/notification-engine';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getTraceId: vi.fn(() => null),
}));
vi.mock('@/lib/server/notifications', () => ({ writeNotification: vi.fn() }));
vi.mock('@/lib/server/notification-engine', () => ({ dispatchNotification: vi.fn() }));

const mockedAuth = vi.mocked(requireSupabaseUser);
const mockedLimit = vi.mocked(checkRateLimit);
const mockedWrite = vi.mocked(writeNotification);
const mockedDispatch = vi.mocked(dispatchNotification);
const USER = { user: { id: 'u1' }, token: 'jwt' } as Awaited<ReturnType<typeof requireSupabaseUser>>;

describe('POST /api/notifications/emit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Legacy path (engine flag off): emit → writeNotification directly.
    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED = '';
    mockedAuth.mockResolvedValue(USER);
    mockedLimit.mockResolvedValue(true);
  });

  it('401 without a valid JWT', async () => {
    mockedAuth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('429 when rate limited', async () => {
    mockedLimit.mockResolvedValue(false);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent' } }), res);
    expect(res.statusCode).toBe(429);
  });

  it('400 on a non-allowlisted kind (no arbitrary notifications)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'weekly_recap' } }), res);
    expect(res.statusCode).toBe(400);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('writes a tx_sent notification with only a validated coin (no free text)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent', coin: 'BTC', lang: 'en' } }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedWrite).toHaveBeenCalledWith('u1', 'tx_sent', 'en', { coin: 'BTC' }, undefined);
  });

  it('drops an invalid coin (e.g. a label with spaces/hyphens)', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent', coin: 'USDT ERC-20' } }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedWrite).toHaveBeenCalledWith('u1', 'tx_sent', 'ru', {}, undefined);
  });

  it('accepts the new tx_failed / price_alert kinds', async () => {
    for (const kind of ['tx_failed', 'price_alert'] as const) {
      mockedWrite.mockClear();
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body: { kind } }), res);
      expect(res.statusCode).toBe(204);
      expect(mockedWrite).toHaveBeenCalledWith('u1', kind, 'ru', {}, undefined);
    }
  });

  it('still rejects server-only kinds (weekly_recap, claim_received)', async () => {
    for (const kind of ['weekly_recap', 'claim_received']) {
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body: { kind } }), res);
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('POST /api/notifications/emit (engine on): Telegram recipient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED = 'true';
    mockedLimit.mockResolvedValue(true);
  });

  it('uses app_metadata.telegram_id (service-role written by tg-auth)', async () => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1', app_metadata: { telegram_id: 42 } }, token: 'jwt' } as never);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent', coin: 'ETH' } }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', telegramId: 42 }));
  });

  it('ignores user-writable user_metadata.telegram_id (no Telegram channel)', async () => {
    mockedAuth.mockResolvedValue({ user: { id: 'u1', app_metadata: {}, user_metadata: { telegram_id: 777 } }, token: 'jwt' } as never);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { kind: 'tx_sent', coin: 'ETH' } }), res);
    expect(res.statusCode).toBe(204);
    expect(mockedDispatch).toHaveBeenCalledWith(expect.objectContaining({ telegramId: null }));
  });
});
