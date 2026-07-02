/**
 * pages/api/risk-event.ts — фиксация риск-оценок и overrides (задача 1.3).
 *
 * POST  { coin, level: warning|block, reasons: RiskReason[], draft_id? } → { id }
 * PATCH { id }  — пользователь осознанно переопределил block →
 *                 строка в override_actions + audit 'risk_override_confirmed'
 *
 * Privacy: адресов в этом endpoint'е НЕТ нигде — только коды причин
 * (см. NIGHT_DECISIONS.md D-1.3-2). Запись под JWT пользователя (RLS).
 * До миграции 0004 вставки тихо скипаются (фича деградирует).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getTraceId, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);
const LEVELS = new Set(['warning', 'block']);
const REASON_CODES = new Set(['first_seen', 'poisoning_similarity', 'blocklisted', 'known_recipient']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase not configured');
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await checkRateLimit(`risk-event:${auth.user.id}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  let supabase;
  try {
    supabase = userClient(auth.token);
  } catch {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  if (req.method === 'POST') {
    const body = req.body as { coin?: string; level?: string; reasons?: unknown; draft_id?: string };
    if (!body.coin || !COINS.has(body.coin)) return res.status(400).json({ error: 'Invalid coin' });
    if (!body.level || !LEVELS.has(body.level)) return res.status(400).json({ error: 'Invalid level' });
    if (!Array.isArray(body.reasons) || body.reasons.length === 0 || body.reasons.length > 8) {
      return res.status(400).json({ error: 'Invalid reasons' });
    }
    // Только известные коды причин; никаких свободных строк (и никаких адресов).
    const reasons = (body.reasons as Array<Record<string, unknown>>)
      .filter((r) => typeof r?.code === 'string' && REASON_CODES.has(r.code as string))
      .map((r) => ({ code: r.code, level: r.level === 'block' ? 'block' : 'warning' }));
    if (reasons.length === 0) return res.status(400).json({ error: 'Invalid reasons' });

    const { data, error } = await supabase
      .from('risk_events')
      .insert({
        user_id: auth.user.id,
        coin: body.coin,
        level: body.level,
        reasons,
        draft_id: typeof body.draft_id === 'string' && UUID_RE.test(body.draft_id) ? body.draft_id : null,
        trace_id: getTraceId(req),
      })
      .select('id')
      .single();

    if (error || !data) {
      // Миграция 0004 не применена — деградируем тихо, клиент не блокируется.
      return res.status(200).json({ id: null });
    }

    await writeAuditLog(auth.user.id, 'risk_flagged', { risk_event_id: data.id, coin: body.coin, level: body.level, reasons: reasons.map((r) => r.code) }, req);
    return res.status(201).json({ id: data.id });
  }

  // PATCH — осознанный override
  const body = req.body as { id?: string };
  if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });

  const { error } = await supabase
    .from('override_actions')
    .insert({ user_id: auth.user.id, risk_event_id: body.id });

  if (error) {
    // FK/RLS не пропустили чужой или несуществующий risk_event
    return res.status(404).json({ error: 'Risk event not found' });
  }

  await writeAuditLog(auth.user.id, 'risk_override_confirmed', { risk_event_id: body.id }, req);
  return res.status(200).json({ ok: true });
}
