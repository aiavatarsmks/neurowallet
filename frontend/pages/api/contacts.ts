/**
 * pages/api/contacts.ts — адресная книга (задача 1.4).
 *
 * GET              → { contacts: Contact[] } (свои, favorites первыми)
 * POST   {name, coin, address, neuro_id?}          → { id } (upsert по user+coin+address)
 * PATCH  {id, name? , is_favorite?}                → { ok }
 * DELETE {id}                                      → { ok }
 *
 * Всё под JWT пользователя (RLS «только своё»). До миграции 0005 GET отдаёт
 * пустой список, мутации — 503 (клиент держит локальную копию).
 * Privacy: адреса/имена в audit_log НЕ пишутся — только contact_id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEURO_RE = /^nw-[a-z0-9]{8,32}$/;

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase not configured');
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  if (!(await checkRateLimit(`contacts:${auth.user.id}`, 30))) {
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
      .from('contacts')
      .select('id, name, coin, address, neuro_id, is_favorite, created_at')
      .order('is_favorite', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    // До миграции 0005 таблицы нет — тихо пустой список.
    if (error) return res.status(200).json({ contacts: [] });
    return res.status(200).json({ contacts: data ?? [] });
  }

  if (req.method === 'POST') {
    const body = req.body as { name?: string; coin?: string; address?: string; neuro_id?: string };
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 64) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    if (!body.coin || !COINS.has(body.coin)) return res.status(400).json({ error: 'Invalid coin' });
    if (typeof body.address !== 'string' || body.address.length < 1 || body.address.length > 128) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    if (body.neuro_id !== undefined && (typeof body.neuro_id !== 'string' || !NEURO_RE.test(body.neuro_id))) {
      return res.status(400).json({ error: 'Invalid neuro_id' });
    }

    const { data, error } = await supabase
      .from('contacts')
      .upsert(
        {
          user_id: auth.user.id,
          name: body.name.trim(),
          coin: body.coin,
          address: body.address.trim(),
          neuro_id: body.neuro_id ?? null,
        },
        { onConflict: 'user_id,coin,address' },
      )
      .select('id')
      .single();

    if (error || !data) return res.status(503).json({ error: 'Contacts unavailable' });

    await writeAuditLog(auth.user.id, 'contact_saved', { contact_id: data.id, coin: body.coin }, req);
    return res.status(201).json({ id: data.id });
  }

  if (req.method === 'PATCH') {
    const body = req.body as { id?: string; name?: string; is_favorite?: boolean };
    if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim().length >= 1 && body.name.trim().length <= 64) {
      patch.name = body.name.trim();
    }
    if (typeof body.is_favorite === 'boolean') patch.is_favorite = body.is_favorite;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const { data, error } = await supabase.from('contacts').update(patch).eq('id', body.id).select('id');
    if (error) return res.status(503).json({ error: 'Contacts unavailable' });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Contact not found' });

    await writeAuditLog(auth.user.id, 'contact_updated', { contact_id: body.id }, req);
    return res.status(200).json({ ok: true });
  }

  // DELETE
  const body = req.body as { id?: string };
  if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
  const { data, error } = await supabase.from('contacts').delete().eq('id', body.id).select('id');
  if (error) return res.status(503).json({ error: 'Contacts unavailable' });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Contact not found' });

  await writeAuditLog(auth.user.id, 'contact_deleted', { contact_id: body.id }, req);
  return res.status(200).json({ ok: true });
}
