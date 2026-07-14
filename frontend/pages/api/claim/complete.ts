import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSupabaseUser, checkRateLimit, writeAuditLog } from '@/lib/server/api-security';
import { completeClaim } from '@/lib/server/claim';
import { claimLinksEnabled } from '@/lib/claim-config';

/**
 * POST /api/claim/complete — recipient claims a link. Auth REQUIRED (they must
 * have onboarded first). Verifies the secret (sha256 == secret_hash) and
 * atomically flips funded → claimed (no double-claim). v1 is demo: NO real
 * credit / chain action happens — the loop + analytics are the point.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, number> = {
  expired: 410, not_found: 404, already_claimed: 409, not_claimable: 409, bad_secret: 403,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  if (!claimLinksEnabled()) return res.status(403).json({ error: 'disabled' });

  let auth;
  try { auth = await requireSupabaseUser(req); } catch { return res.status(401).json({ error: 'unauthorized' }); }

  if (!(await checkRateLimit(`claim-complete:${auth.user.id}`, 30))) return res.status(429).json({ error: 'rate_limited' });

  const body = req.body as { ref?: string; secret?: string; session_id?: string };
  if (typeof body.ref !== 'string' || !UUID_RE.test(body.ref)) return res.status(400).json({ error: 'bad_ref' });
  if (typeof body.secret !== 'string' || !body.secret) return res.status(400).json({ error: 'bad_secret' });
  const sessionId = typeof body.session_id === 'string' && UUID_RE.test(body.session_id) ? body.session_id : null;

  const result = await completeClaim(body.ref, body.secret, auth.user.id, sessionId);
  if ('error' in result) return res.status(STATUS[result.error] ?? 400).json({ error: result.error });

  await writeAuditLog(auth.user.id, 'claim_claimed', { asset: result.asset, network: result.network, is_demo: result.isDemo }, req);
  return res.status(200).json({ ok: true, asset: result.asset, network: result.network, amount: result.amount, is_demo: result.isDemo });
}
