import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { generateWeeklyRecap } from '@/lib/server/recap';
import { weeklyRecapEnabled, type Lang } from '@/lib/recap-content';

/**
 * POST /api/notifications/recap — build & deliver the caller's weekly AI recap.
 * Auth required. Flag-gated (NEXT_PUBLIC_WEEKLY_RECAP_ENABLED): when off the
 * endpoint is inert (403). The client may call this on app open at most once a
 * week; the server is authoritative via per-ISO-week dedup, so extra calls are
 * cheap no-ops (status `deduped`). No request text is trusted — the summary is
 * composed server-side from the user's own analytics_events (counts only).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!weeklyRecapEnabled()) return res.status(403).json({ error: 'disabled' });

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Building a recap is cheap but hits the DB; keep it modestly rate-limited.
  if (!(await checkRateLimit(`notif-recap:${auth.user.id}`, 10))) {
    return res.status(429).end();
  }

  const body = (req.body ?? {}) as { lang?: string };
  const lang: Lang = body.lang === 'en' ? 'en' : 'ru';
  const telegramId = Number(auth.user.user_metadata?.telegram_id);

  const result = await generateWeeklyRecap({
    userId: auth.user.id,
    lang,
    telegramId: Number.isFinite(telegramId) && telegramId ? telegramId : null,
    req,
  });

  return res.status(200).json({ status: result.status });
}
