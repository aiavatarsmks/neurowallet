/**
 * pages/api/policies.ts — Policy Engine CRUD (задача 3.1). All under the user's
 * JWT (RLS "own"). GET list / POST create / PATCH toggle enabled / DELETE.
 * Rule params are validated + normalised server-side (amounts stored as decimal
 * strings, scaled per lib/policy-check). Flag-gated: inert (503) unless the
 * engine flag is on, so nothing is user-visible until you enable it.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { policyEngineEnabled } from '@/lib/policy-engine';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^[0-9]{1,20}$/;
const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);
const TYPES = new Set([
  'max_amount_per_tx', 'max_amount_per_day', 'allowed_networks', 'blocked_recipients',
  'first_time_recipient_confirm', 'require_approval_for_contract', 'allow_automation',
]);

const strArr = (v: unknown, max = 50): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= 128)
    ? (v as string[])
    : null;

/** Validate + normalise a rule for a type. Returns a clean rule or null. */
function validateRule(type: string, raw: unknown): Record<string, unknown> | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const amt = (v: unknown) => (typeof v === 'string' && AMOUNT_RE.test(v) ? v : null);
  switch (type) {
    case 'max_amount_per_tx':
    case 'max_amount_per_day': {
      const maxAmount = amt(r.maxAmount);
      if (!maxAmount) return null;
      const out: Record<string, unknown> = { maxAmount };
      if (typeof r.asset === 'string' && COINS.has(r.asset)) out.asset = r.asset;
      return out;
    }
    case 'allowed_networks': {
      const networks = strArr(r.networks);
      return networks && networks.length > 0 ? { networks } : null;
    }
    case 'blocked_recipients': {
      const addresses = strArr(r.addresses);
      return addresses && addresses.length > 0 ? { addresses } : null;
    }
    case 'first_time_recipient_confirm': {
      const thresholdAmount = amt(r.thresholdAmount);
      return thresholdAmount ? { thresholdAmount } : null;
    }
    case 'require_approval_for_contract':
      return {};
    case 'allow_automation': {
      const kinds = strArr(r.kinds, 10);
      if (!kinds || kinds.length === 0) return null;
      const out: Record<string, unknown> = { kinds };
      if (r.assets !== undefined) { const a = strArr(r.assets); if (a) out.assets = a; }
      if (r.recipients !== undefined) { const a = strArr(r.recipients); if (a) out.recipients = a; }
      if (r.maxAmount !== undefined) { const m = amt(r.maxAmount); if (m) out.maxAmount = m; }
      return out;
    }
    default:
      return null;
  }
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase not configured');
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!policyEngineEnabled()) return res.status(503).json({ error: 'disabled' });
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!(await checkRateLimit(`policies:${auth.user.id}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  let supabase;
  try {
    supabase = userClient(auth.token);
  } catch {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('policies')
      .select('id, enabled, type, rule, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(200).json({ policies: [] }); // pre-migration → empty
    return res.status(200).json({ policies: data ?? [] });
  }

  if (req.method === 'POST') {
    const body = req.body as { type?: string; rule?: unknown };
    if (!body.type || !TYPES.has(body.type)) return res.status(400).json({ error: 'Invalid type' });
    const rule = validateRule(body.type, body.rule);
    if (!rule) return res.status(400).json({ error: 'Invalid rule' });

    const { data, error } = await supabase
      .from('policies')
      .insert({ user_id: auth.user.id, type: body.type, rule })
      .select('id')
      .single();
    if (error || !data) return res.status(503).json({ error: 'Policies unavailable' });
    await writeAuditLog(auth.user.id, 'policy_created', { policy_id: data.id, type: body.type }, req);
    return res.status(201).json({ id: data.id });
  }

  if (req.method === 'PATCH') {
    const body = req.body as { id?: string; enabled?: boolean };
    if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
    if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'Nothing to update' });
    const { data, error } = await supabase
      .from('policies')
      .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
      .eq('id', body.id)
      .select('id');
    if (error) return res.status(503).json({ error: 'Policies unavailable' });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Not found' });
    await writeAuditLog(auth.user.id, 'policy_updated', { policy_id: body.id, enabled: body.enabled }, req);
    return res.status(200).json({ ok: true });
  }

  // DELETE
  const body = req.body as { id?: string };
  if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
  const { data, error } = await supabase.from('policies').delete().eq('id', body.id).select('id');
  if (error) return res.status(503).json({ error: 'Policies unavailable' });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Not found' });
  await writeAuditLog(auth.user.id, 'policy_deleted', { policy_id: body.id }, req);
  return res.status(200).json({ ok: true });
}
