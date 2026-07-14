import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, getClientIp } from '@/lib/server/api-security';
import { getClaimStatus } from '@/lib/server/claim';
import { claimLinksEnabled } from '@/lib/claim-config';

/**
 * GET /api/claim/status?ref=<id> — non-sensitive claim status for the claim
 * page (recipient may be anonymous). Never returns the secret_hash. Lazy
 * expiry: an active-but-expired link is flipped to 'expired' here.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  if (!claimLinksEnabled()) return res.status(403).json({ error: 'disabled' });

  const ip = getClientIp(req) ?? 'noip';
  if (!(await checkRateLimit(`claim-status:ip:${ip}`, 60))) return res.status(429).json({ error: 'rate_limited' });

  const ref = typeof req.query.ref === 'string' ? req.query.ref : '';
  if (!UUID_RE.test(ref)) return res.status(400).json({ error: 'bad_ref' });

  const status = await getClaimStatus(ref);
  if (!status) return res.status(404).json({ error: 'not_found' });
  return res.status(200).json(status);
}
