/**
 * pages/api/recipient-history.ts — адреса успешных отправок пользователя
 * (задача 1.3). Источник для first-seen/similarity эвристик risk engine.
 *
 * GET ?coin=ETH → { addresses: string[] } (уникальные, до 200 последних)
 *
 * Работает под JWT пользователя — RLS tx_drafts отдаёт только свои строки.
 * До применения миграции 0003 таблицы нет → тихо возвращаем пустой список.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';

const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);

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

  if (!(await checkRateLimit(`recipient-history:${auth.user.id}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const coin = String(req.query.coin ?? '');
  if (!COINS.has(coin)) return res.status(400).json({ error: 'Invalid coin' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
    });
    const { data, error } = await supabase
      .from('tx_drafts')
      .select('to_address')
      .eq('coin', coin)
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      // Таблица ещё не создана (миграция не применена) или иная ошибка —
      // деградируем в пустую историю, risk engine покажет first_seen.
      return res.status(200).json({ addresses: [] });
    }
    const addresses = Array.from(new Set((data ?? []).map((r) => r.to_address)));
    return res.status(200).json({ addresses });
  } catch {
    return res.status(200).json({ addresses: [] });
  }
}
