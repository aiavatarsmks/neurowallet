import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSupabaseUser, checkRateLimit, getClientIp, writeAuditLog } from '@/lib/server/api-security';
import { createClaim } from '@/lib/server/claim';
import { claimLinksEnabled, isClaimAsset, CLAIM_NETWORK } from '@/lib/claim-config';

/**
 * POST /api/claim/create — create a claim link (задача 2.8, v1 demo).
 * Auth-optional: a demo sender has no Supabase session, so we accept an
 * anonymous sender via session_id (like /api/track). v1 is DEMO-ONLY —
 * is_demo must be true; real-money claims are v2+. No chain action here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  if (!claimLinksEnabled()) return res.status(403).json({ error: 'disabled' });

  let senderUserId: string | null = null;
  try { senderUserId = (await requireSupabaseUser(req)).user.id; } catch { senderUserId = null; }

  const body = req.body as {
    asset?: string; network?: string; amount?: number; secret_hash?: string;
    dedupe_key?: string; is_demo?: boolean; session_id?: string; target_tg_id?: string;
  };

  // v1: demo only. Real-money (is_demo=false) is v2+ and stays closed.
  if (body.is_demo !== true) return res.status(400).json({ error: 'demo_only' });

  const sessionId = typeof body.session_id === 'string' && UUID_RE.test(body.session_id) ? body.session_id : null;
  if (!senderUserId && !sessionId) return res.status(400).json({ error: 'no_sender' });

  const ip = getClientIp(req) ?? 'noip';
  const rlKey = senderUserId ? `claim-create:${senderUserId}` : `claim-create:ip:${ip}`;
  if (!(await checkRateLimit(rlKey, 20))) return res.status(429).json({ error: 'rate_limited' });

  if (!isClaimAsset(body.asset)) return res.status(400).json({ error: 'bad_asset' });
  if (body.network !== CLAIM_NETWORK) return res.status(400).json({ error: 'bad_network' });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });
  if (typeof body.secret_hash !== 'string' || !SHA256_RE.test(body.secret_hash)) return res.status(400).json({ error: 'bad_secret_hash' });
  if (typeof body.dedupe_key !== 'string' || body.dedupe_key.length < 8 || body.dedupe_key.length > 128) return res.status(400).json({ error: 'bad_dedupe' });

  const result = await createClaim({
    senderUserId, senderSessionId: sessionId,
    asset: body.asset, network: body.network, amount,
    secretHash: body.secret_hash, dedupeKey: body.dedupe_key, isDemo: true,
    targetTgId: typeof body.target_tg_id === 'string' ? body.target_tg_id.slice(0, 64) : null,
  });
  if ('error' in result) return res.status(result.error.startsWith('too_many') ? 429 : 400).json({ error: result.error });

  if (senderUserId) {
    await writeAuditLog(senderUserId, 'claim_created', { asset: body.asset, network: body.network, is_demo: true }, req);
  }
  return res.status(200).json({ ref: result.id, expires_at: result.expiresAt });
}
