/**
 * pages/api/tx-draft.ts — драфты переводов + результаты симуляции (задача 1.2).
 *
 * POST  — создать драфт с приложенным результатом симуляции → { id }
 * PATCH — обновить статус своего драфта после отправки (sent/failed, tx_hash)
 *
 * Записи идут под JWT пользователя (не service role) — RLS «только своё»
 * enforce'ится самой базой. Privacy: адрес получателя хранится ТОЛЬКО в
 * tx_drafts (см. пометку в SUPABASE_SCHEMA.md) и сознательно не пишется
 * в audit_log.metadata и analytics_events.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getTraceId, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);
const SIM_STATUSES = new Set(['ok', 'timeout', 'error']);
const DRAFT_STATUSES = new Set(['sent', 'failed']);
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

  if (!(await checkRateLimit(`tx-draft:${auth.user.id}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const supabase = userClient(auth.token);

  if (req.method === 'POST') {
    const body = req.body as {
      coin?: string;
      to_address?: string;
      amount?: number;
      simulation?: { status?: string; fee_native?: number | null; fee_currency?: string; fee_eur?: number | null; warnings?: unknown };
    };

    if (!body.coin || !COINS.has(body.coin)) return res.status(400).json({ error: 'Invalid coin' });
    if (typeof body.to_address !== 'string' || body.to_address.length < 1 || body.to_address.length > 128) {
      return res.status(400).json({ error: 'Invalid to_address' });
    }
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const { data: draft, error } = await supabase
      .from('tx_drafts')
      .insert({
        user_id: auth.user.id,
        coin: body.coin,
        to_address: body.to_address,
        amount: body.amount,
        trace_id: getTraceId(req),
      })
      .select('id')
      .single();

    if (error || !draft) {
      console.error('[tx-draft] insert failed:', error?.message);
      return res.status(500).json({ error: 'Draft creation failed' });
    }

    const sim = body.simulation;
    if (sim && typeof sim.status === 'string' && SIM_STATUSES.has(sim.status)) {
      const { error: simError } = await supabase.from('simulation_results').insert({
        draft_id: draft.id,
        status: sim.status,
        fee_native: typeof sim.fee_native === 'number' ? sim.fee_native : null,
        fee_currency: typeof sim.fee_currency === 'string' ? sim.fee_currency.slice(0, 8) : null,
        fee_eur: typeof sim.fee_eur === 'number' ? sim.fee_eur : null,
        warnings: Array.isArray(sim.warnings) ? sim.warnings.slice(0, 16) : null,
      });
      if (simError) console.warn('[tx-draft] simulation insert skipped:', simError.message);
    }

    // Privacy: ни адреса, ни суммы в audit-метаданных — только факт и монета.
    await writeAuditLog(auth.user.id, 'tx_draft_created', { draft_id: draft.id, coin: body.coin }, req);
    return res.status(201).json({ id: draft.id });
  }

  // PATCH — финализация статуса своего драфта
  const body = req.body as { id?: string; status?: string; tx_hash?: string };
  if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
  if (!body.status || !DRAFT_STATUSES.has(body.status)) return res.status(400).json({ error: 'Invalid status' });

  const { error, data } = await supabase
    .from('tx_drafts')
    .update({
      status: body.status,
      tx_hash: typeof body.tx_hash === 'string' ? body.tx_hash.slice(0, 128) : null,
    })
    .eq('id', body.id)
    .select('id');

  if (error) {
    console.error('[tx-draft] update failed:', error.message);
    return res.status(500).json({ error: 'Draft update failed' });
  }
  if (!data || data.length === 0) return res.status(404).json({ error: 'Draft not found' });

  await writeAuditLog(auth.user.id, 'tx_draft_updated', { draft_id: body.id, status: body.status }, req);
  return res.status(200).json({ ok: true });
}
