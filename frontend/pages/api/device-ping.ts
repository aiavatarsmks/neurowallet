/**
 * pages/api/device-ping.ts — регистрация/heartbeat устройства (задача 1.6).
 * Вызывается клиентом раз на вкладку после SIGNED_IN. Сервер сам считает
 * sha256(user-agent) и усечённую метку — клиентскому вводу не доверяем.
 * До миграции 0007 — тихая деградация.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await checkRateLimit(`device-ping:${auth.user.id}`, 10))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(204).end();

  const ua = String(req.headers['user-agent'] ?? 'unknown');
  const uaHash = createHash('sha256').update(ua).digest('hex').slice(0, 32);

  try {
    const svc = createClient(url, serviceKey);
    const { error } = await svc.from('devices').upsert(
      {
        user_id: auth.user.id,
        ua_hash: uaHash,
        ua_label: ua.slice(0, 96),
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id,ua_hash' },
    );
    if (error) return res.status(204).end(); // миграция не применена — тихо
  } catch { /* тихо */ }

  return res.status(204).end();
}
