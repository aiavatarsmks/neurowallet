/**
 * lib/server/telegram-id.ts
 * The ONLY place the server decides which Telegram chat belongs to a user.
 *
 * Trust model:
 *   - app_metadata is writable only with the service role. /api/tg-auth sets
 *     app_metadata.telegram_id after the initData HMAC check, so it is proof
 *     that the account was opened from that Telegram user's Mini App.
 *   - user_metadata is writable by the user (supabase.auth.updateUser({data}))
 *     and email signup is open, so anyone can put any telegram_id there. It is
 *     NEVER used to address bot messages (that was a phishing primitive).
 */

import { createClient, type User } from '@supabase/supabase-js';

export const TELEGRAM_SOURCE = 'telegram_mini_app';

type UserLike = { app_metadata?: User['app_metadata'] | null } | null | undefined;

/** Verified Telegram id from app_metadata, or null. user_metadata is ignored. */
export function getVerifiedTelegramId(user: UserLike): number | null {
  const raw: unknown = user?.app_metadata?.telegram_id;
  let id = NaN;
  if (typeof raw === 'number') id = raw;
  else if (typeof raw === 'string' && /^\d{1,16}$/.test(raw)) id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type TelegramMetaSync = 'unchanged' | 'updated' | 'skipped' | 'failed';

/**
 * Best-effort: record the verified Telegram id in app_metadata via the admin
 * API. Writes only when the stored value differs. Never throws: login must not
 * break if the service key is missing or GoTrue is unhappy.
 *
 * GoTrue merges top-level app_metadata keys on admin update, so provider /
 * providers are preserved; we send only the two keys we own.
 */
export async function syncTelegramAppMetadata(
  user: { id: string; app_metadata?: User['app_metadata'] | null },
  telegramId: number,
): Promise<TelegramMetaSync> {
  if (getVerifiedTelegramId(user) === telegramId && user.app_metadata?.source === TELEGRAM_SOURCE) {
    return 'unchanged';
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn('[tg-auth] SUPABASE_SERVICE_ROLE_KEY not set: app_metadata.telegram_id not recorded, Telegram notifications stay off for this user');
    return 'skipped';
  }

  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { telegram_id: telegramId, source: TELEGRAM_SOURCE },
    });
    if (error) {
      console.warn('[tg-auth] app_metadata update failed:', error.message);
      return 'failed';
    }
    return 'updated';
  } catch (err) {
    console.warn('[tg-auth] app_metadata update failed:', err instanceof Error ? err.message : err);
    return 'failed';
  }
}
