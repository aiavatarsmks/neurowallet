/**
 * pages/api/device-ping.ts — регистрация/heartbeat устройства (задача 1.6).
 * Вызывается клиентом раз на вкладку после SIGNED_IN. Сервер сам считает
 * sha256(user-agent) и усечённую метку — клиентскому вводу не доверяем.
 * До миграции 0007 — тихая деградация.
 *
 * Audit: email-входы раньше не попадали в audit_log (логин идёт напрямую в
 * Supabase Auth, мимо нашего API). Этот вызов и есть серверная точка «сессия
 * началась на устройстве», поэтому здесь пишется `session_started`
 * { method: 'email' }, его показывает security center. Telegram-аккаунты
 * пропускаем: для них tg-auth уже пишет `tg_auth_login`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient, type User } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { getVerifiedTelegramId } from '@/lib/server/telegram-id';

function isTelegramAccount(user: Pick<User, 'email' | 'app_metadata'>): boolean {
  return getVerifiedTelegramId(user) !== null || /@neurowallet\.tg$/i.test(user.email ?? '');
}

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
    // Ошибка = миграция 0007 не применена: тихо, но audit ниже всё равно пишем.
    await svc.from('devices').upsert(
      {
        user_id: auth.user.id,
        ua_hash: uaHash,
        ua_label: ua.slice(0, 96),
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id,ua_hash' },
    );
  } catch { /* тихо */ }

  if (!isTelegramAccount(auth.user)) {
    await writeAuditLog(auth.user.id, 'session_started', { method: 'email' }, req);
  }

  return res.status(204).end();
}
