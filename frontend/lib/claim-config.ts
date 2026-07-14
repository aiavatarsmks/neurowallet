/**
 * lib/claim-config.ts — shared config for claim links (задача 2.8).
 * No secrets, no crypto here — safe on client and server.
 */

// TON-first (2.10): default claim asset is USDT on TON.
export const CLAIM_ASSETS = ['USDT_TON', 'TON'] as const;
export type ClaimAsset = (typeof CLAIM_ASSETS)[number];
export const CLAIM_DEFAULT_ASSET: ClaimAsset = 'USDT_TON';
export const CLAIM_NETWORK = 'ton';

/** Feature flag (Vercel env NEXT_PUBLIC_CLAIM_LINKS_ENABLED=true). Off by default. */
export function claimLinksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLAIM_LINKS_ENABLED === 'true';
}

/** Expiry / guardrails — overridable via env, all default per DECISION_2.8. */
export const CLAIM_EXPIRY_DAYS = Number(process.env.NEXT_PUBLIC_CLAIM_EXPIRY_DAYS) || 7;
export const CLAIM_MAX_ACTIVE_PER_USER = Number(process.env.CLAIM_MAX_ACTIVE) || 20;
export const CLAIM_MAX_PER_DAY = Number(process.env.CLAIM_MAX_PER_DAY) || 20;

export function isClaimAsset(v: unknown): v is ClaimAsset {
  return typeof v === 'string' && (CLAIM_ASSETS as readonly string[]).includes(v);
}

/**
 * Canonical shareable URL — structure is FINAL across v1/v2/v3 so the UX/schema
 * never gets rewritten: `<app>/claim?ref=<id>#s=<secret>`.
 * The secret lives in the URL FRAGMENT (after '#') and never reaches the server;
 * the backend only ever stores sha256(secret).
 */
export function buildClaimUrl(appUrl: string, ref: string, secret: string): string {
  const base = appUrl.replace(/\/$/, '');
  return `${base}/claim?ref=${encodeURIComponent(ref)}#s=${encodeURIComponent(secret)}`;
}

/** Parse ref (query) + secret (fragment) from the current location. */
export function parseClaimFromLocation(loc: { search: string; hash: string }): { ref: string; secret: string } | null {
  const ref = new URLSearchParams(loc.search).get('ref');
  const secret = new URLSearchParams(loc.hash.replace(/^#/, '')).get('s');
  if (!ref) return null;
  return { ref, secret: secret ?? '' };
}
