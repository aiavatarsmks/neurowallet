/**
 * lib/price-rate.ts
 * Light, import-free reader of the live EUR→USD rate from the price cache.
 *
 * DisplayCurrencyContext is mounted in _app for every page; importing it from
 * lib/crypto/balances pulled ethers, @ton/ton and the TRON code into the shared
 * _app chunk. This module only reads localStorage. balances.ts writes the cache
 * (key and event names are defined here and re-used there).
 */

/** localStorage key of the price cache written by lib/crypto/balances.ts. */
export const PRICE_CACHE_KEY = 'nw_prices_cache_v2';
/** Fired on window after fresh prices are cached (DisplayCurrencyContext listens). */
export const PRICES_UPDATED_EVENT = 'nw:prices-updated';

/** Plausible USD per 1 EUR, else null (guards against a corrupt cache). */
export function usdPerEurOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0.5 && v < 2 ? v : null;
}

/** Live USD per 1 EUR from the price cache (any age), or null. */
export function getCachedUsdPerEur(): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { usdPerEur?: unknown } | null;
    return usdPerEurOrNull(c?.usdPerEur);
  } catch {
    return null;
  }
}
