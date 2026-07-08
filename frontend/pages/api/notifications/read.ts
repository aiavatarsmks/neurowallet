import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseUser } from '@/lib/server/api-security';

/**
 * POST /api/notifications/read — mark the caller's notifications read.
 * Body: { id } to mark one, or { all: true } to mark all unread. Uses the
 * service role but is always scoped to auth.uid() so a user can only touch
 * their own rows.
 */
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

  const { id, all } = req.body as { id?: string; all?: boolean };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) return res.status(204).end();

  try {
    const supabase = createClient(url, serviceKey);
    let q = supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', auth.user.id)
      .is('read_at', null);
    if (!all && id) q = q.eq('id', id);
    await q;
  } catch (err) {
    console.warn('[notifications/read] skipped:', err instanceof Error ? err.message : err);
  }
  return res.status(204).end();
}
