import type { NextApiRequest } from 'next';
import { createClient, type User } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';

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

// Upstash Redis client, lazily initialized from env. When the env vars are
// absent or Redis is unreachable, we fall back to the in-memory limiter
// (per lambda instance — softer, but the endpoint keeps working).
let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

/**
 * Durable fixed-window limiter (Upstash Redis, shared across all lambda
 * instances) with in-memory fallback. The window is encoded in the key
 * (minute bucket), so there are no expire races.
 */
export async function checkRateLimit(key: string, maxPerMinute: number): Promise<boolean> {
  const r = getRedis();
  if (r) {
    try {
      const bucket = `rl:${key}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`;
      const count = await r.incr(bucket);
      if (count === 1) await r.expire(bucket, 90);
      return count <= maxPerMinute;
    } catch (err) {
      console.warn('[rate-limit] Upstash unavailable, in-memory fallback:', err instanceof Error ? err.message : err);
    }
  }
  return checkRateLimitMemory(key, maxPerMinute);
}

/** In-memory fallback: per lambda instance, resets on cold start. */
export function checkRateLimitMemory(key: string, maxPerMinute: number): boolean {
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

/** Validated x-trace-id request header (client-generated UUID per flow), or null. */
export function getTraceId(req: NextApiRequest): string | null {
  const v = req.headers['x-trace-id'];
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v.toLowerCase()
    : null;
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
    const traceId = getTraceId(req);
    await supabase.from('audit_log').insert({
      user_id: userId,
      action,
      metadata: traceId ? { ...metadata, trace_id: traceId } : metadata,
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] ?? null,
    });
  } catch (err) {
    console.warn('[audit-log] skipped:', err instanceof Error ? err.message : err);
  }
}

export function getClientIp(req: NextApiRequest): string | null {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') return forwardedFor.split(',')[0]?.trim() || null;
  return req.socket.remoteAddress ?? null;
}
