/**
 * pages/api/neuro-id/resolve.ts
 * NeuroID → one address for one coin.
 *
 * neuro_directory is private (migration 0012: SELECT own only), so the lookup
 * runs with the service role, server-side, for ONE exact neuro_id, selecting
 * only the column for the requested coin. The response never carries the
 * other chains' addresses or the owner's user_id. Works before and after 0012
 * (the service role bypasses RLS).
 *
 * Anti-impersonation: a legit row always has neuro_id = neuroIdFromUserId(user_id)
 * (the client derives it). Rows that don't match were forged through the old
 * open upsert path and are treated as not found, even before 0012's CHECK
 * is applied.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { addressColumnForCoin, neuroIdFromUserId, normalizeNeuroId, type NeuroCoin } from '@/lib/neuro-id';

const VALID_COINS = new Set<NeuroCoin>(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);

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

  if (!(await checkRateLimit(`neuro-id-resolve:${auth.user.id}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const neuroId = normalizeNeuroId(String(req.query.neuro_id ?? ''));
  const coin = String(req.query.coin ?? 'ETH') as NeuroCoin;
  if (!/^nw-[a-z0-9]{8,32}$/.test(neuroId)) {
    return res.status(400).json({ error: 'Invalid NeuroID' });
  }
  if (!VALID_COINS.has(coin)) {
    return res.status(400).json({ error: 'Unsupported coin' });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(503).json({ error: 'NeuroID lookup unavailable' });

  const column = addressColumnForCoin(coin);
  const svc = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let row: Record<string, unknown> | null;
  try {
    const { data, error } = await svc
      .from('neuro_directory')
      .select(`user_id, neuro_id, display_name, ${column}`)
      .eq('neuro_id', neuroId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: 'NeuroID lookup failed' });
    row = (data as Record<string, unknown> | null) ?? null;
  } catch {
    return res.status(500).json({ error: 'NeuroID lookup failed' });
  }

  if (!row || typeof row.user_id !== 'string' || row.neuro_id !== neuroIdFromUserId(row.user_id)) {
    return res.status(404).json({ error: 'NeuroID not found' });
  }

  const address = typeof row[column] === 'string' ? (row[column] as string) : '';
  if (!address) return res.status(404).json({ error: 'Recipient has no address for this coin' });

  await writeAuditLog(auth.user.id, 'neuro_id_resolved', { neuro_id: neuroId, coin }, req);

  return res.status(200).json({
    neuro_id: row.neuro_id,
    display_name: typeof row.display_name === 'string' ? row.display_name : null,
    coin,
    address,
    internal: true,
    settlement: 'onchain',
  });
}
