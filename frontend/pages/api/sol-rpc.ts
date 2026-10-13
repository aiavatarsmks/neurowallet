import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { solanaRpcUrl } from '@/lib/server/provider-keys';
import { SOL_RPC_METHODS, SOL_SERVER_RPC_URLS, solRpc, SolRpcError, type SolRpcMethod } from '@/lib/crypto/sol-rpc';

/**
 * pages/api/sol-rpc.ts
 * Same-origin Solana JSON-RPC proxy, the browser's fallback (lib/crypto/sol-rpc.ts).
 *
 * The official RPC refuses browser requests (403 on any Origin header), so the
 * server, which sends no Origin, can reach it. With SOLANA_RPC_URL set (server
 * env, keyed provider) that endpoint goes first.
 *
 * - Supabase JWT required + per-user rate limit: not an open RPC relay.
 * - Only the wallet's methods (SOL_RPC_METHODS), params must be a small array.
 * - Public data only: addresses, signed transactions, signatures. No audit_log
 *   write (balance polling would flood it); the send itself is audited elsewhere.
 * - Response mirrors JSON-RPC: { result } or { error: { code, message } }.
 */

const MAX_BODY_CHARS = 8_192;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: -32600, message: 'Method not allowed' } });
  }

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: { code: 401, message: 'Unauthorized' } });
  }

  if (!(await checkRateLimit(`sol-rpc:${auth.user.id}`, 60))) {
    return res.status(429).json({ error: { code: 429, message: 'Rate limit exceeded' } });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { method?: unknown; params?: unknown };
  const method = body.method;
  const params = body.params;
  if (typeof method !== 'string' || !(SOL_RPC_METHODS as readonly string[]).includes(method)) {
    return res.status(400).json({ error: { code: -32601, message: 'Method not allowed' } });
  }
  if (!Array.isArray(params) || params.length > 4 || JSON.stringify(params).length > MAX_BODY_CHARS) {
    return res.status(400).json({ error: { code: -32602, message: 'Invalid params' } });
  }

  const keyed = solanaRpcUrl();
  const urls = keyed ? [keyed, ...SOL_SERVER_RPC_URLS] : [...SOL_SERVER_RPC_URLS];

  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await solRpc(method as SolRpcMethod, params, { urls, timeoutMs: 8_000 });
    return res.status(200).json({ jsonrpc: '2.0', id: 1, result });
  } catch (e) {
    if (e instanceof SolRpcError) {
      // A real node answer (e.g. preflight failure): pass it through unchanged.
      return res.status(200).json({ jsonrpc: '2.0', id: 1, error: { code: e.code, message: e.message.slice(0, 300) } });
    }
    console.warn('[sol-rpc] all upstreams failed:', e instanceof Error ? e.message.slice(0, 300) : e);
    return res.status(502).json({ error: { code: 502, message: 'Solana RPC unavailable' } });
  }
}
