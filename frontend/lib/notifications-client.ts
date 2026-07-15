import { supabase } from './supabase';

/** Kinds the client may trigger. Server-to-server kinds (recap, claim_received)
 * are NOT here — they're dispatched from backend routes only. */
export type ClientNotificationKind = 'tx_sent' | 'tx_failed' | 'security_alert' | 'price_alert';

/**
 * Fire-and-forget client trigger for an in-app notification. Best-effort:
 * never throws, never blocks the caller (a failed inbox write must not affect
 * a real transaction). The server composes all text.
 */
export async function emitNotification(
  kind: ClientNotificationKind,
  opts: { coin?: string; lang?: 'ru' | 'en'; traceId?: string } = {},
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return; // demo / not signed in — nothing to record
    await fetch('/api/notifications/emit', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.traceId ? { 'x-trace-id': opts.traceId } : {}),
      },
      body: JSON.stringify({ kind, coin: opts.coin, lang: opts.lang }),
    });
  } catch {
    /* best-effort */
  }
}

const RECAP_THROTTLE_KEY = 'nw_recap_requested_week';

/**
 * Ask the server to build/deliver this week's AI recap (задача 2.7). Client-side
 * throttle (one call per ISO week) is a courtesy — the server is authoritative
 * via per-week dedup, so extra calls are cheap no-ops. Best-effort, never throws.
 */
export async function requestWeeklyRecap(weekKey: string, lang: 'ru' | 'en' = 'ru'): Promise<void> {
  try {
    if (typeof window !== 'undefined' && localStorage.getItem(RECAP_THROTTLE_KEY) === weekKey) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return; // demo / signed out — no recap
    await fetch('/api/notifications/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lang }),
    });
    if (typeof window !== 'undefined') localStorage.setItem(RECAP_THROTTLE_KEY, weekKey);
  } catch {
    /* best-effort */
  }
}

/** Shape returned/accepted by /api/notifications/prefs (snake_case, matches DB). */
export interface NotificationPrefs {
  telegram_enabled: boolean;
  transactional_enabled: boolean;
  security_enabled: boolean;
  price_enabled: boolean;
  promotional_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start_min: number;
  quiet_end_min: number;
  tz_offset_min: number;
}

async function authFetch(path: string, init: RequestInit): Promise<Response | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

/** Load the caller's notification preferences (null when signed out / disabled). */
export async function getNotificationPrefs(): Promise<NotificationPrefs | null> {
  try {
    const r = await authFetch('/api/notifications/prefs', { method: 'GET' });
    if (!r || !r.ok) return null;
    return (await r.json()) as NotificationPrefs;
  } catch {
    return null;
  }
}

/** Persist the caller's notification preferences. Returns the saved row or null. */
export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs | null> {
  try {
    const r = await authFetch('/api/notifications/prefs', { method: 'POST', body: JSON.stringify(prefs) });
    if (!r || !r.ok) return null;
    return (await r.json()) as NotificationPrefs;
  } catch {
    return null;
  }
}
