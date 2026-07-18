/**
 * lib/swap-quote.ts — pure, provider-agnostic swap fee/slippage math (задача 2.2).
 * No secrets, no network, no crypto — safe on client and server, fully testable.
 *
 * This is the decision-neutral core of "swap v1": given a router quote (gross
 * output in the smallest token unit), it computes OUR transparent margin and the
 * slippage-protected minimum received. Acceptance ("прозрачный fee breakdown,
 * наша маржа видна пользователю") is satisfied by exposing every number here.
 *
 * Amounts are BigInt in the token's smallest unit (wei-style) — never floats —
 * so there is no rounding drift on money. The router adapter (1inch, chosen in
 * DECISION_2.2) lives in the API route; this module knows nothing about it.
 *
 * NOTE: the markup % is a *default from the plan* (~0.85%), overridable via env —
 * NOT a final pricing decision. The engine reads it; product sets the real number.
 */

/** Basis points helper: amount * bps / 10000, floored (BigInt division). */
export function bpsOf(amount: bigint, bps: number): bigint {
  if (amount < 0n) throw new Error('amount must be non-negative');
  if (!Number.isInteger(bps) || bps < 0) throw new Error('bps must be a non-negative integer');
  return (amount * BigInt(bps)) / 10_000n;
}

/** Our platform fee taken from the gross output, and what the user keeps. */
export function applyMarkup(grossOut: bigint, markupBps: number): { ourFee: bigint; netOut: bigint } {
  const ourFee = bpsOf(grossOut, markupBps);
  return { ourFee, netOut: grossOut - ourFee };
}

/** Slippage-protected floor: the minimum the user will accept to receive. */
export function minReceived(netOut: bigint, slippageBps: number): bigint {
  return netOut - bpsOf(netOut, slippageBps);
}

export interface FeeBreakdown {
  grossOut: string; // router output before our fee (smallest unit)
  markupBps: number; // our margin, transparent
  ourFee: string; // our fee amount (smallest unit)
  netOut: string; // what the user receives before slippage
  slippageBps: number; // applied slippage tolerance
  minReceived: string; // slippage-protected floor
}

/**
 * Build the full, user-visible fee breakdown from a router's gross output.
 * Every field is returned as a decimal string (smallest unit) for safe JSON
 * transport — the UI formats them with the token's decimals.
 */
export function buildFeeBreakdown(
  grossOut: bigint,
  opts: { markupBps: number; slippageBps: number },
): FeeBreakdown {
  const { ourFee, netOut } = applyMarkup(grossOut, opts.markupBps);
  const floor = minReceived(netOut, opts.slippageBps);
  return {
    grossOut: grossOut.toString(),
    markupBps: opts.markupBps,
    ourFee: ourFee.toString(),
    netOut: netOut.toString(),
    slippageBps: opts.slippageBps,
    minReceived: floor.toString(),
  };
}

// ── Config (plan-grounded defaults; overridable via env) ─────────────────────

/** Plan target: swap margin ~0.85% → 85 bps. Product confirms the final number. */
export const DEFAULT_MARKUP_BPS = Number(process.env.SWAP_MARKUP_BPS) || 85;
/** Default slippage tolerance and a hard cap the user cannot exceed. */
export const DEFAULT_SLIPPAGE_BPS = 100; // 1.0%
export const MAX_SLIPPAGE_BPS = 500; // 5.0% — refuse anything looser

/** Clamp a requested slippage into [0, MAX]; fall back to default when invalid. */
export function clampSlippageBps(requested: unknown): number {
  const n = Number(requested);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(Math.floor(n), MAX_SLIPPAGE_BPS);
}

/**
 * Chains swap v1 covers via the chosen router (1inch): EVM + SOL + TON. TRX/BTC
 * are out of v1 scope (no single-chain DEX route) — shown as "swap coming" per
 * DECISION_2.2, never faked.
 */
export const SWAP_V1_CHAINS: ReadonlySet<string> = new Set(['ETH', 'SOL', 'TON', 'USDT', 'USDT_TON']);
export function isSwappableV1(coin: string): boolean {
  return SWAP_V1_CHAINS.has(coin);
}

/** Feature flag. Off by default — swap routes inert, no UI entry. */
export function swapEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SWAP_ENABLED === 'true';
}
