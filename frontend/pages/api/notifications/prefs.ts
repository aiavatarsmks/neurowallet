import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import { notificationsEngineEnabled, DEFAULT_RULES } from '@/lib/notifications-config';

/**
 * /api/notifications/prefs — preference center for the notification engine (2.4).
 *   GET  → the caller's rules (defaults if no row yet).
 *   POST → upsert the caller's rules (validated, service-role write).
 * Flag-gated: when the engine flag is off the endpoint is inert (403). Auth
 * required; a user can only ever read/write their own row.
 */

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const clampMin = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1439 ? n : d;
};
const clampTz = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= -840 && n <= 840 ? n : d;
};

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function rowToJson(row: Record<string, unknown> | null) {
  const r = row ?? {};
  return {
    telegram_enabled: bool(r.telegram_enabled, DEFAULT_RULES.telegramEnabled),
    transactional_enabled: bool(r.transactional_enabled, DEFAULT_RULES.transactionalEnabled),
    security_enabled: true, // security is never silenced
    price_enabled: bool(r.price_enabled, DEFAULT_RULES.priceEnabled),
    promotional_enabled: bool(r.promotional_enabled, DEFAULT_RULES.promotionalEnabled),
    quiet_hours_enabled: bool(r.quiet_hours_enabled, DEFAULT_RULES.quietHoursEnabled),
    quiet_start_min: clampMin(r.quiet_start_min, DEFAULT_RULES.quietStartMin),
    quiet_end_min: clampMin(r.quiet_end_min, DEFAULT_RULES.quietEndMin),
    tz_offset_min: clampTz(r.tz_offset_min, DEFAULT_RULES.tzOffsetMin),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!notificationsEngineEnabled()) return res.status(403).json({ error: 'disabled' });

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = svc();
  if (!db) return res.status(200).json(rowToJson(null));

  if (req.method === 'GET') {
    if (!(await checkRateLimit(`notif-prefs-get:${auth.user.id}`, 60))) return res.status(429).end();
    try {
      const { data } = await db.from('notification_rules').select('*').eq('user_id', auth.user.id).maybeSingle();
      return res.status(200).json(rowToJson(data as Record<string, unknown> | null));
    } catch {
      return res.status(200).json(rowToJson(null));
    }
  }

  if (req.method === 'POST') {
    if (!(await checkRateLimit(`notif-prefs-set:${auth.user.id}`, 20))) return res.status(429).end();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = {
      user_id: auth.user.id,
      telegram_enabled: bool(b.telegram_enabled, DEFAULT_RULES.telegramEnabled),
      transactional_enabled: bool(b.transactional_enabled, DEFAULT_RULES.transactionalEnabled),
      security_enabled: true,
      price_enabled: bool(b.price_enabled, DEFAULT_RULES.priceEnabled),
      promotional_enabled: bool(b.promotional_enabled, DEFAULT_RULES.promotionalEnabled),
      quiet_hours_enabled: bool(b.quiet_hours_enabled, DEFAULT_RULES.quietHoursEnabled),
      quiet_start_min: clampMin(b.quiet_start_min, DEFAULT_RULES.quietStartMin),
      quiet_end_min: clampMin(b.quiet_end_min, DEFAULT_RULES.quietEndMin),
      tz_offset_min: clampTz(b.tz_offset_min, DEFAULT_RULES.tzOffsetMin),
      updated_at: new Date().toISOString(),
    };
    try {
      await db.from('notification_rules').upsert(row, { onConflict: 'user_id' });
      return res.status(200).json(rowToJson(row));
    } catch {
      return res.status(500).json({ error: 'save_failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
}
