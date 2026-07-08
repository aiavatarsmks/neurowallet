import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSupabaseUser, checkRateLimit, getTraceId } from '@/lib/server/api-security';
import { writeNotification, type NotificationKind, type Lang } from '@/lib/server/notifications';

/**
 * POST /api/notifications/emit — record an in-app notification for the caller.
 * Auth required. The client only names an allowlisted kind (+ validated coin);
 * the server composes the text. No free text, no amounts/addresses. Rate limited.
 */

const ALLOWED_KINDS: NotificationKind[] = ['tx_sent', 'security_alert'];
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

  await writeNotification(auth.user.id, kind, lang, meta, dedupe);
  return res.status(204).end();
}
