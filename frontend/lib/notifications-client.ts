import { supabase } from './supabase';

/**
 * Fire-and-forget client trigger for an in-app notification. Best-effort:
 * never throws, never blocks the caller (a failed inbox write must not affect
 * a real transaction). The server composes all text.
 */
export async function emitNotification(
  kind: 'tx_sent' | 'security_alert',
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
