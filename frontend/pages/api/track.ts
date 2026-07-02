/**
 * pages/api/track.ts — приём аналитических событий (Фаза 1.1).
 *
 * Клиент никогда не пишет в analytics_events напрямую (RLS deny) — только
 * через этот endpoint. Правила:
 *  - allowlist имён событий И разрешённых ключей properties (анти-PII);
 *  - значения properties — только примитивы, длина строки ≤ 64;
 *  - auth опционален: события онбординга идут до создания аккаунта
 *    (user_id = null, склейка по session_id через session_identified);
 *  - rate limit: 60/мин на пользователя, 30/мин на IP для анонимных.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getTraceId, requireSupabaseUser } from '@/lib/server/api-security';

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
};

// event → разрешённые ключи properties. Всё вне списка молча отбрасывается.
const EVENTS: Record<string, readonly string[]> = {
  onboarding_started: [],
  wallet_created: [],
  wallet_imported: [],
  send_initiated: ['coin'],
  send_succeeded: ['coin'],
  send_failed: ['coin', 'reason_code'],
  send_review_shown: ['coin'],
  send_review_blocked: ['coin', 'reason_code'],
  first_send_succeeded: ['coin'],
  ai_chat_used: ['lang'],
  demo_entered: [],
  session_identified: [],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeProperties(
  event: string,
  raw: unknown,
): Record<string, string | number | boolean> | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const allowed = EVENTS[event];
  const out: Record<string, string | number | boolean> = {};
  for (const key of allowed) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v;
    else if (typeof v === 'string') out[key] = v.slice(0, 64);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  // Auth опционален: с Bearer — событие пользователя, без — анонимное.
  let userId: string | null = null;
  try {
    userId = (await requireSupabaseUser(req)).user.id;
  } catch {
    userId = null;
  }

  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : null) ?? req.socket.remoteAddress ?? 'unknown';
  const limitKey = userId ? `track:${userId}` : `track:ip:${ip}`;
  if (!(await checkRateLimit(limitKey, userId ? 60 : 30))) {
    return res.status(429).end();
  }

  const body = req.body as { event?: string; properties?: unknown; session_id?: string };
  if (!body.event || !(body.event in EVENTS)) {
    return res.status(400).json({ error: 'Unknown event' });
  }
  if (!body.session_id || !UUID_RE.test(body.session_id)) {
    return res.status(400).json({ error: 'Invalid session_id' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (serviceKey && url) {
    try {
      const supabase = createClient(url, serviceKey);
      await supabase.from('analytics_events').insert({
        user_id: userId,
        session_id: body.session_id.toLowerCase(),
        event: body.event,
        properties: sanitizeProperties(body.event, body.properties),
        trace_id: getTraceId(req),
      });
    } catch (err) {
      console.warn('[track] skipped:', err instanceof Error ? err.message : err);
    }
  }

  return res.status(204).end();
}
