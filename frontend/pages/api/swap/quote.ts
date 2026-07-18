import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSupabaseUser, checkRateLimit } from '@/lib/server/api-security';
import {
  swapEnabled,
  isSwappableV1,
  clampSlippageBps,
  buildFeeBreakdown,
  DEFAULT_MARKUP_BPS,
} from '@/lib/swap-quote';

/**
 * POST /api/swap/quote — read-only swap price quote with our transparent fee
 * breakdown (задача 2.2, swap v1). This NEVER executes a swap or moves funds —
 * it only fetches a router price and returns numbers for the review screen.
 *
 * Hard-gated and inert by default:
 *   - flag NEXT_PUBLIC_SWAP_ENABLED must be 'true', else 503;
 *   - ONEINCH_API_KEY (server-only) must be set, else 503;
 *   - auth (Supabase JWT) + rate limit required.
 * So with no key / flag off, the whole feature is a no-op — safe to ship dark.
 *
 * The router (1inch, chosen in DECISION_2.2) is isolated in routerGrossOut().
 * Signing/execution is intentionally NOT here — that needs the deterministic
 * signer + explicit user confirmation (CLAUDE.md money invariant), added later.
 */

interface QuoteBody {
  fromCoin?: string;
  toCoin?: string;
  amount?: string; // smallest unit, decimal string
  slippageBps?: number;
}

const AMOUNT_RE = /^[0-9]{1,40}$/;

/**
 * Router adapter — fetch the gross output amount (smallest unit) for a swap.
 *
 * ⚠️ VERIFY BEFORE ENABLING: endpoint, params and response shape must be checked
 * against the current 1inch Swap API docs, and per-chain token-address
 * resolution (symbol → contract) wired, before this can serve real quotes. It is
 * isolated here so that correction is a one-function change and the pure fee math
 * (lib/swap-quote) and this route's gating/validation are already tested.
 */
async function routerGrossOut(_params: {
  apiKey: string;
  fromCoin: string;
  toCoin: string;
  amount: string;
}): Promise<bigint | null> {
  // Placeholder integration point. Returns null until the real 1inch call +
  // token-address resolution are wired (see warning above). Route stays inert.
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!swapEnabled()) return res.status(503).json({ error: 'unavailable' });

  let auth;
  try {
    auth = await requireSupabaseUser(req);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!(await checkRateLimit(`swap-quote:${auth.user.id}`, 30))) {
    return res.status(429).end();
  }

  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'unavailable' });

  const body = (req.body ?? {}) as QuoteBody;
  const fromCoin = String(body.fromCoin ?? '');
  const toCoin = String(body.toCoin ?? '');
  if (!isSwappableV1(fromCoin) || !isSwappableV1(toCoin) || fromCoin === toCoin) {
    return res.status(400).json({ error: 'unsupported_pair' });
  }
  if (typeof body.amount !== 'string' || !AMOUNT_RE.test(body.amount) || body.amount === '0') {
    return res.status(400).json({ error: 'bad_amount' });
  }
  const slippageBps = clampSlippageBps(body.slippageBps);

  let grossOut: bigint | null;
  try {
    grossOut = await routerGrossOut({ apiKey, fromCoin, toCoin, amount: body.amount });
  } catch {
    return res.status(200).json({ error: 'quote_unavailable' });
  }
  if (grossOut === null || grossOut <= 0n) {
    return res.status(200).json({ error: 'quote_unavailable' });
  }

  const breakdown = buildFeeBreakdown(grossOut, { markupBps: DEFAULT_MARKUP_BPS, slippageBps });
  return res.status(200).json({ fromCoin, toCoin, amountIn: body.amount, ...breakdown });
}
