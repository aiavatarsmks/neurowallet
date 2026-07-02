import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';
import { getAddressForCoin, normalizeNeuroId, type NeuroCoin, type NeuroDirectoryRow } from '@/lib/neuro-id';

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
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(500).json({ error: 'Supabase not configured' });

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } },
  });

  const { data, error } = await supabase
    .from('neuro_directory')
    .select('user_id, neuro_id, display_name, eth_address, sol_address, btc_address, tron_address, ton_address')
    .eq('neuro_id', neuroId)
    .maybeSingle<NeuroDirectoryRow>();

  if (error) return res.status(500).json({ error: 'NeuroID lookup failed' });
  if (!data) return res.status(404).json({ error: 'NeuroID not found' });

  const address = getAddressForCoin(data, coin);
  if (!address) return res.status(404).json({ error: 'Recipient has no address for this coin' });

  await writeAuditLog(auth.user.id, 'neuro_id_resolved', { neuro_id: neuroId, coin }, req);

  return res.status(200).json({
    neuro_id: data.neuro_id,
    display_name: data.display_name,
    coin,
    address,
    internal: true,
    settlement: 'onchain',
  });
}
