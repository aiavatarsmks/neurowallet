import type { NextApiRequest, NextApiResponse } from 'next';
import { checkRateLimit, requireSupabaseUser } from '@/lib/server/api-security';
import { toncenterApiKey, trongridHeaders, trongridApiKey } from '@/lib/server/provider-keys';
import { fetchTronAccountBalances } from '@/lib/crypto/tron-tx';
import { fetchTonBalanceStrict, fetchUsdtTonBalanceStrict } from '@/lib/crypto/ton-tx';
import type { BalancesResponse } from '@/lib/balances-types';

/**
 * pages/api/balances.ts
 * Server-side balance proxy for TON / USDT-TON and TRX / USDT-TRC20, so that
 * provider API keys (TONCENTER_API_KEY, TRONGRID_API_KEY) stay on the server.
 *
 * - Only public addresses in, only numbers out. No key material involved.
 * - A chain is served only when its key is configured. Without a key the
 *   field is null and the client falls back to its direct keyless call — a
 *   keyless proxy would funnel every user through one Vercel IP and hit the
 *   free limit faster than per-browser calls.
 * - Per-chain failure → null (client falls back), never a fake 0.
 * - No audit_log write: balances are polled every 30 s (read-only, public data).
 */

const ADDRESS_FORMATS = {
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ton:  /^([A-Za-z0-9_-]{48}|-?\d+:[a-fA-F0-9]{64})$/,
};

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

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

  // Four widgets poll every 30 s; allow headroom for a couple of tabs.
  if (!(await checkRateLimit(`balances:${auth.user.id}`, 40))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { ton, tron } = req.query as Record<string, string | undefined>;
  if (ton !== undefined && !ADDRESS_FORMATS.ton.test(ton)) {
    return res.status(400).json({ error: 'Invalid ton address' });
  }
  if (tron !== undefined && !ADDRESS_FORMATS.tron.test(tron)) {
    return res.status(400).json({ error: 'Invalid tron address' });
  }

  const tonKey = toncenterApiKey();
  const tronKeyed = Boolean(trongridApiKey());

  const [tonBal, usdtTonBal, tronBal] = await Promise.all([
    ton && tonKey ? orNull(fetchTonBalanceStrict(ton, tonKey)) : Promise.resolve(null),
    ton && tonKey ? orNull(fetchUsdtTonBalanceStrict(ton, tonKey)) : Promise.resolve(null),
    tron && tronKeyed ? orNull(fetchTronAccountBalances(tron, trongridHeaders())) : Promise.resolve(null),
  ]);

  const body: BalancesResponse = {
    ton: tonBal,
    usdtTon: usdtTonBal,
    trx: tronBal?.trx ?? null,
    usdtTrc: tronBal?.usdtTrc ?? null,
  };
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(body);
}
