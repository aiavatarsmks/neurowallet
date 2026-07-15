import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSupabaseUser, checkRateLimit, getTraceId } from '@/lib/server/api-security';
import { writeNotification, type Lang } from '@/lib/server/notifications';
import { dispatchNotification } from '@/lib/server/notification-engine';
import { notificationsEngineEnabled, type NotificationKind } from '@/lib/notifications-config';

/**
 * POST /api/notifications/emit — record a notification for the caller.
 * Auth required. The client only names an allowlisted kind (+ validated coin);
 * the server composes the text. No free text, no amounts/addresses. Rate limited.
 *
 * When NEXT_PUBLIC_NOTIFICATIONS_ENGINE_ENABLED is on, the request is routed
 * through the rule engine (preferences, quiet hours, dedup, Telegram channel).
 * When off, it degrades to the original inbox-only insert — so the flag is a
 * clean, inert rollback.
 */

// Client-triggerable kinds. security_alert/price_alert stay allowlisted; recap
// & claim_received are emitted server-to-server only, not from this endpoint.
const ALLOWED_KINDS: NotificationKind[] = ['tx_sent', 'tx_failed', 'security_alert', 'price_alert'];
const COIN_RE = /^[A-Z0-9_]{2,10}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!(await checkRateLimit(`notif-emit:${auth.user.id}`, 30))) {
    return res.status(429).end();
  }

  const body = req.body as { kind?: string; coin?: string; lang?: string };
  const kind = body.kind as NotificationKind;
  if (!ALLOWED_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'bad kind' });
  }

  const lang: Lang = body.lang === 'en' ? 'en' : 'ru';
  const meta: Record<string, string> = {};
  if (typeof body.coin === 'string' && COIN_RE.test(body.coin)) meta.coin = body.coin;

  const traceId = getTraceId(req);
  if (traceId) meta.trace_id = traceId;
  // One notification per event: dedupe on kind+trace when a trace id is present.
  const dedupe = traceId ? `${kind}:${traceId}` : undefined;

  if (notificationsEngineEnabled()) {
    const telegramId = Number(auth.user.user_metadata?.telegram_id);
    await dispatchNotification({
      userId: auth.user.id,
      kind,
      lang,
      meta,
      dedupeKey: dedupe,
      telegramId: Number.isFinite(telegramId) && telegramId ? telegramId : null,
      req,
    });
  } else {
    await writeNotification(auth.user.id, kind, lang, meta, dedupe);
  }
  return res.status(204).end();
}
