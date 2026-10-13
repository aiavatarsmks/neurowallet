/**
 * pages/api/security-feed.ts — лента security-событий пользователя (1.6).
 *
 * audit_log закрыт для клиентов (deny by default) — фид отдаёт СВОИ события
 * пользователя через service role, отфильтрованные по allowlist безопасных
 * action'ов, и только безопасные поля метаданных (coin, level, status).
 * Адреса/суммы в фид не попадают by construction (их нет в audit metadata).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';

// Filtered IN THE QUERY (.in) so noisy actions (tx_history_requested,
// ai_chat_*, ...) can't push logins out of the window. Exported for tests.
export const FEED_ACTIONS = [
  'tg_auth_login',
  'session_started', // email sessions, written by /api/device-ping
  'risk_flagged',
  'risk_override_confirmed',
  'tx_draft_created',
  'tx_draft_updated',
  'payment_request_created',
  'payment_request_updated',
  'contact_saved',
  'contact_deleted',
] as const;

const FEED_LIMIT = 30;

const SAFE_META_KEYS = new Set(['coin', 'level', 'status', 'reasons', 'method']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await checkRateLimit(`security-feed:${auth.user.id}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(200).json({ events: [] });

  try {
    const svc = createClient(url, serviceKey);
    const { data, error } = await svc
      .from('audit_log')
      .select('action, metadata, created_at')
      .eq('user_id', auth.user.id)
      .in('action', [...FEED_ACTIONS])
      .order('created_at', { ascending: false })
      .limit(FEED_LIMIT);

    if (error || !data) return res.status(200).json({ events: [] });

    // Defence in depth: re-check the allowlist even though the query filters.
    const allowed = new Set<string>(FEED_ACTIONS);
    const events = data
      .filter((row) => allowed.has(row.action))
      .slice(0, FEED_LIMIT)
      .map((row) => ({
        action: row.action,
        created_at: row.created_at,
        meta: Object.fromEntries(
          Object.entries((row.metadata as Record<string, unknown>) ?? {}).filter(([k]) => SAFE_META_KEYS.has(k)),
        ),
      }));

    return res.status(200).json({ events });
  } catch {
    return res.status(200).json({ events: [] });
  }
}
