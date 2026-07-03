/**
 * pages/api/payment-request.ts — платёжные ссылки (задача 1.5).
 *
 * POST  (auth)  {coin, address, amount?, expires_hours?} → { id, url }
 * GET   (аноним) ?id=uuid → { status, coin, amount, address, expires_at }
 *               — плательщик открывает ссылку без логина; capability = сам
 *               непредсказуемый uuid. Expiry enforce'ится здесь же.
 * PATCH (auth)  {id, status: completed|cancelled} — только владелец (RLS).
 *
 * Резолв и события viewed/expired идут через service role (у anon нет
 * политик на таблицу — см. D-1.5-1). До миграции 0006 — тихая деградация.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, requireSupabaseUser, writeAuditLog } from '@/lib/server/api-security';

const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://neurowallet.tech';
const MAX_EXPIRES_HOURS = 168; // 7 дней
const DEFAULT_EXPIRES_HOURS = 24;

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase not configured');
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return resolveRequest(req, res);
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await checkRateLimit(`payment-request:${auth.user.id}`, 20))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  let supabase;
  try {
    supabase = userClient(auth.token);
  } catch {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  if (req.method === 'POST') {
    const body = req.body as { coin?: string; address?: string; amount?: number; expires_hours?: number };
    if (!body.coin || !COINS.has(body.coin)) return res.status(400).json({ error: 'Invalid coin' });
    if (typeof body.address !== 'string' || body.address.length < 1 || body.address.length > 128) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    if (body.amount !== undefined && (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const hours = Math.min(
      MAX_EXPIRES_HOURS,
      Math.max(1, Math.round(typeof body.expires_hours === 'number' ? body.expires_hours : DEFAULT_EXPIRES_HOURS)),
    );

    const { data, error } = await supabase
      .from('payment_requests')
      .insert({
        user_id: auth.user.id,
        coin: body.coin,
        address: body.address.trim(),
        amount: body.amount ?? null,
        expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) return res.status(503).json({ error: 'Payment links unavailable' });

    const svc = serviceClient();
    if (svc) await svc.from('payment_events').insert({ request_id: data.id, event: 'created' });

    await writeAuditLog(auth.user.id, 'payment_request_created', { request_id: data.id, coin: body.coin }, req);
    return res.status(201).json({ id: data.id, url: `${APP_URL}/pay/${data.id}` });
  }

  // PATCH — completed | cancelled (владелец)
  const body = req.body as { id?: string; status?: string };
  if (!body.id || !UUID_RE.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
  if (body.status !== 'completed' && body.status !== 'cancelled') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { data, error } = await supabase
    .from('payment_requests')
    .update({ status: body.status })
    .eq('id', body.id)
    .eq('status', 'active')
    .select('id');

  if (error) return res.status(503).json({ error: 'Payment links unavailable' });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Request not found or not active' });

  const svc = serviceClient();
  if (svc) await svc.from('payment_events').insert({ request_id: body.id, event: body.status });

  await writeAuditLog(auth.user.id, 'payment_request_updated', { request_id: body.id, status: body.status }, req);
  return res.status(200).json({ ok: true });
}

/** Анонимный резолв ссылки: rate limit по IP, expiry проверяется на месте. */
async function resolveRequest(req: NextApiRequest, res: NextApiResponse) {
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : null) ?? req.socket.remoteAddress ?? 'unknown';
  if (!(await checkRateLimit(`payment-resolve:${ip}`, 30))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const id = String(req.query.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const svc = serviceClient();
  if (!svc) return res.status(503).json({ error: 'Payment links unavailable' });

  const { data, error } = await svc
    .from('payment_requests')
    .select('id, coin, amount, address, status, expires_at')
    .eq('id', id)
    .maybeSingle();

  if (error) return res.status(503).json({ error: 'Payment links unavailable' });
  if (!data) return res.status(404).json({ error: 'Not found' });

  // Ленивое протухание: active + просрочен → пометить и отдать expired.
  if (data.status === 'active' && new Date(data.expires_at).getTime() < Date.now()) {
    await svc.from('payment_requests').update({ status: 'expired' }).eq('id', id).eq('status', 'active');
    await svc.from('payment_events').insert({ request_id: id, event: 'expired' });
    return res.status(200).json({ id, status: 'expired' });
  }

  if (data.status !== 'active') {
    return res.status(200).json({ id, status: data.status });
  }

  await svc.from('payment_events').insert({ request_id: id, event: 'viewed' });
  return res.status(200).json({
    id,
    status: 'active',
    coin: data.coin,
    amount: data.amount,
    address: data.address,
    expires_at: data.expires_at,
  });
}
