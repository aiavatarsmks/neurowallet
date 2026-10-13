/**
 * pages/api/health.ts
 * GET /api/health: readiness probe for uptime monitors.
 *
 * No auth, rate-limited per IP, Cache-Control: no-store. Reports only
 * booleans/enums about the configuration, never env values.
 *
 *   200 { ok: true,  time, checks: { supabase: 'ok',   rateLimitStore, auditLog } }
 *   503 { ok: false, time, checks: { supabase: 'fail', rateLimitStore, auditLog } }
 *
 * supabase:       anon-key PostgREST ping (GET /rest/v1/profiles?select=id&limit=1,
 *                 RLS returns [] for anon), 2 s timeout. Proves gateway +
 *                 PostgREST + DB are reachable with the public key.
 * rateLimitStore: 'durable' when the Upstash env is set, else 'memory'.
 * auditLog:       'on' when SUPABASE_SERVICE_ROLE_KEY is set, else 'off'
 *                 (writeAuditLog silently no-ops without it).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, getClientIp } from '@/lib/server/api-security';

const SUPABASE_TIMEOUT_MS = 2000;
const MAX_PER_MINUTE_PER_IP = 30;

async function pingSupabase(): Promise<'ok' | 'fail'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return 'fail';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUPABASE_TIMEOUT_MS);
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/profiles?select=id&limit=1`, {
      method: 'GET',
      headers: { apikey: anonKey, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    return r.ok ? 'ok' : 'fail';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req) ?? 'noip';
  if (!(await checkRateLimit(`health:${ip}`, MAX_PER_MINUTE_PER_IP))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const supabase = await pingSupabase();
  const ok = supabase === 'ok';

  return res.status(ok ? 200 : 503).json({
    ok,
    time: new Date().toISOString(),
    checks: {
      supabase,
      rateLimitStore:
        process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'durable' : 'memory',
      auditLog: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'on' : 'off',
    },
  });
}
