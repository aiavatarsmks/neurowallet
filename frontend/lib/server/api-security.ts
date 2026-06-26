import type { NextApiRequest } from 'next';
import { createClient, type User } from '@supabase/supabase-js';

const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

function getBearerToken(req: NextApiRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase not configured');
  return { url, anonKey };
}

export async function requireSupabaseUser(req: NextApiRequest): Promise<{ user: User; token: string }> {
  const token = getBearerToken(req);
  if (!token) throw new Error('UNAUTHORIZED');

  const { url, anonKey } = getSupabaseConfig();
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');

  return { user: data.user, token };
}

export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (current.count >= maxPerMinute) return false;
  current.count += 1;
  return true;
}

export async function writeAuditLog(
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
  req: NextApiRequest,
): Promise<void> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return;

  try {
    const { url } = getSupabaseConfig();
    const supabase = createClient(url, serviceKey);
    await supabase.from('audit_log').insert({
      user_id: userId,
      action,
      metadata,
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] ?? null,
    });
  } catch (err) {
    console.warn('[audit-log] skipped:', err instanceof Error ? err.message : err);
  }
}

function getClientIp(req: NextApiRequest): string | null {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') return forwardedFor.split(',')[0]?.trim() || null;
  return req.socket.remoteAddress ?? null;
}
