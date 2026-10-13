import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getVerifiedTelegramId, syncTelegramAppMetadata, TELEGRAM_SOURCE } from '@/lib/server/telegram-id';

const admin = vi.hoisted(() => ({ updateUserById: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { admin } })),
}));

describe('getVerifiedTelegramId', () => {
  it('ignores user_metadata entirely (user-writable)', () => {
    expect(getVerifiedTelegramId({ user_metadata: { telegram_id: 42 } } as never)).toBeNull();
    expect(getVerifiedTelegramId({ app_metadata: {}, user_metadata: { telegram_id: 42 } } as never)).toBeNull();
  });

  it('reads app_metadata.telegram_id (number or digit string)', () => {
    expect(getVerifiedTelegramId({ app_metadata: { telegram_id: 42 } })).toBe(42);
    expect(getVerifiedTelegramId({ app_metadata: { telegram_id: '7000000001' } })).toBe(7000000001);
  });

  it('rejects junk, zero, negatives and unsafe integers', () => {
    for (const v of [0, -5, 1.5, 'abc', '42abc', '', null, undefined, {}, Number.MAX_SAFE_INTEGER + 2, NaN]) {
      expect(getVerifiedTelegramId({ app_metadata: { telegram_id: v } })).toBeNull();
    }
    expect(getVerifiedTelegramId(null)).toBeNull();
    expect(getVerifiedTelegramId(undefined)).toBeNull();
  });
});

describe('syncTelegramAppMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    admin.updateUserById.mockResolvedValue({ data: {}, error: null });
  });

  it('writes telegram_id + source via the admin API when missing', async () => {
    const r = await syncTelegramAppMetadata({ id: 'u1', app_metadata: { provider: 'email' } }, 42);
    expect(r).toBe('updated');
    expect(admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: { telegram_id: 42, source: TELEGRAM_SOURCE },
    });
  });

  it('does not write when app_metadata already matches', async () => {
    const r = await syncTelegramAppMetadata({ id: 'u1', app_metadata: { telegram_id: 42, source: TELEGRAM_SOURCE } }, 42);
    expect(r).toBe('unchanged');
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it('overwrites a different stored id', async () => {
    const r = await syncTelegramAppMetadata({ id: 'u1', app_metadata: { telegram_id: 7, source: TELEGRAM_SOURCE } }, 42);
    expect(r).toBe('updated');
  });

  it('skips quietly without the service key', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await syncTelegramAppMetadata({ id: 'u1', app_metadata: {} }, 42)).toBe('skipped');
    expect(admin.updateUserById).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never throws: GoTrue error or exception → failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await syncTelegramAppMetadata({ id: 'u1', app_metadata: {} }, 42)).toBe('failed');
    admin.updateUserById.mockRejectedValueOnce(new Error('network'));
    expect(await syncTelegramAppMetadata({ id: 'u1', app_metadata: {} }, 42)).toBe('failed');
    warn.mockRestore();
  });
});
