/**
 * lib/onramp-config.ts — pure, provider-agnostic on-ramp gating (задача 2.3).
 * No secrets, no network, no provider SDK — safe on client and server, testable.
 *
 * Decision-neutral core only: the region capability gate ("честный отказ до KYC")
 * and the TON-first asset allowlist. The actual provider (MoonPay/Transak/Ramp —
 * undecided, see DECISION_2.3), its hosted flow, order schema and webhooks are
 * NOT here — they depend on the provider choice.
 *
 * Posture: deny by default. An unknown/unsupported region is refused BEFORE any
 * KYC or provider redirect (plan acceptance: "неподдерживаемый регион — честный
 * отказ до KYC").
 */

/**
 * EU-first launch allowlist (business context: EU freelancers/self-employed).
 * ISO-3166 alpha-2. This is a conservative STARTING list — product + the chosen
 * provider's coverage decide the final set; extend via ONRAMP_REGIONS env.
 */
const DEFAULT_REGIONS = [
  'DE', 'FR', 'ES', 'IT', 'NL', 'PL', 'PT', 'IE', 'BE', 'AT', 'FI', 'SE', 'DK', 'EE', 'LT', 'LV',
];

function configuredRegions(): ReadonlySet<string> {
  const env = process.env.ONRAMP_REGIONS;
  const list = env ? env.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean) : DEFAULT_REGIONS;
  return new Set(list);
}

export type RegionDecision = { available: boolean; reason: 'ok' | 'unsupported_region' | 'unknown_region' };

/** Honest availability check BEFORE any KYC/redirect. Unknown → refused. */
export function onrampAvailableForRegion(region: unknown): RegionDecision {
  if (typeof region !== 'string' || !/^[A-Za-z]{2}$/.test(region)) {
    return { available: false, reason: 'unknown_region' };
  }
  return configuredRegions().has(region.toUpperCase())
    ? { available: true, reason: 'ok' }
    : { available: false, reason: 'unsupported_region' };
}

/**
 * TON-first asset set for on-ramp v1 (compliance: TON-native positioning). Buy
 * TON / USDT-TON first; other assets are added per provider coverage later.
 */
export const ONRAMP_V1_ASSETS: ReadonlySet<string> = new Set(['TON', 'USDT_TON']);
export function isOnrampAsset(asset: string): boolean {
  return ONRAMP_V1_ASSETS.has(asset);
}

/** Order lifecycle for the (later) provider-webhook reconciler. Terminal states end it. */
export type RampOrderStatus = 'created' | 'pending' | 'completed' | 'failed' | 'expired';
export function isTerminalRampStatus(s: RampOrderStatus): boolean {
  return s === 'completed' || s === 'failed' || s === 'expired';
}

/** Feature flag. Off by default — no on-ramp surface, no provider session. */
export function onrampEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ONRAMP_ENABLED === 'true';
}
