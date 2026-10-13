/**
 * lib/crypto/balances.ts
 * Real blockchain balance fetching via public RPC endpoints and CoinGecko.
 * ETH/SOL/BTC/prices: client-side, keyless (ETH via the shared provider in
 * eth-provider.ts). TON/USDT-TON and TRX/USDT-TRC20: first via /api/balances
 * (server-side provider keys, never in the bundle), per-chain fallback to the
 * direct keyless call when the server has no key or fails.
 *
 * Honesty rules:
 *  - A provider failure is never shown as 0. Every fetcher throws on failure
 *    (network, non-2xx incl. 429, JSON-RPC error, malformed body); only a
 *    genuinely empty account yields 0. A failed asset is listed in
 *    `unavailable` and shows its last good value (localStorage), or 0 when
 *    there is none.
 *  - Prices are cached only when CoinGecko returned a complete answer. On
 *    failure the last cached prices are used even past their TTL, and the
 *    built-in constants only when there is no cache at all; both set
 *    `pricesStale`. Fallback or partial data is never written to the cache.
 */

import { ethers } from 'ethers';
import { fetchUsdtTrc20Balance, fetchTrxBalance } from './tron-tx';
import { fetchTonBalance, fetchUsdtTonBalance } from './ton-tx';
import { getEthProvider } from './eth-provider';
import { solRpc } from './sol-rpc';
import { SUPPORTED_ASSETS, type AssetSymbol } from './assets';
import { coinLabel } from '@/lib/coin-labels';
import type { BalancesResponse } from '@/lib/balances-types';
import { PRICE_CACHE_KEY, PRICES_UPDATED_EVENT, usdPerEurOrNull, getCachedUsdPerEur } from '@/lib/price-rate';

// Re-exported for existing importers; the light module keeps _app small.
export { PRICES_UPDATED_EVENT, getCachedUsdPerEur };

const USDT_ADDR  = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // ERC-20 Mainnet
const ERC20_ABI  = ['function balanceOf(address) view returns (uint256)'];
/** Blockstream first, mempool.space as fallback: same /address response shape. */
const BTC_ADDRESS_APIS = ['https://blockstream.info/api/address/', 'https://mempool.space/api/address/'];

const PRICE_IDS = ['ethereum', 'solana', 'bitcoin', 'tron', 'the-open-network', 'tether'] as const;
const PRICES_URL =
  `https://api.coingecko.com/api/v3/simple/price?ids=${PRICE_IDS.join(',')}` +
  '&vs_currencies=eur,usd&include_24hr_change=true&include_last_updated_at=true';

/** v2: the v1 key ('nw_prices_cache') may hold fallback constants written as if fresh. */
const LEGACY_PRICE_CACHE_KEY = 'nw_prices_cache';
const LAST_BALANCES_KEY = 'nw_last_balances_v1';
export const MARKET_REFRESH_MS = 30_000; // near-real-time without hammering public APIs
const PRICE_TTL_MS    = MARKET_REFRESH_MS;

export interface WalletBalances {
  eth:      number;
  usdt:     number;   // ERC-20
  usdtTrc:  number;   // TRC-20
  trx:      number;
  usdtTon:  number;   // TON Jetton
  sol:      number;
  btc:      number;   // confirmed only
  ton:      number;
  ethEur:   number;
  solEur:   number;
  btcEur:   number;
  trxEur:   number;
  tonEur:   number;
  usdtEur:  number;   // USDT ≠ 1 EUR (≈0.9) — курс из CoinGecko (tether)
  ethChange24h: number;
  solChange24h: number;
  btcChange24h: number;
  trxChange24h: number;
  tonChange24h: number;
  priceUpdatedAt: number;
  /**
   * Assets whose fetch failed this round. Their amounts above are the last
   * known good values (or 0 if none were ever fetched): do not treat them as
   * real zeros (e.g. no "insufficient funds" on them).
   */
  unavailable: AssetSymbol[];
  /** Prices are not fresh this round: last cached prices or built-in constants. */
  pricesStale: boolean;
  /** Incoming unconfirmed BTC (mempool), not included in `btc`. */
  btcPending: number;
  /** USD per 1 EUR from the price feed (cached), or null when unknown. */
  usdPerEur: number | null;
}

export interface PriceData {
  ethEur:   number;
  solEur:   number;
  btcEur:   number;
  trxEur:   number;
  tonEur:   number;
  usdtEur:  number;   // USDT ≠ 1 EUR (≈0.9) — курс из CoinGecko (tether)
  ethChange24h: number;
  solChange24h: number;
  btcChange24h: number;
  trxChange24h: number;
  tonChange24h: number;
  priceUpdatedAt: number;
  fetchedAt: number;
  /** USD per 1 EUR derived from the same response (bitcoin.usd / bitcoin.eur). */
  usdPerEur: number | null;
  /** true: not a fresh CoinGecko answer (last cached prices or the constants below). */
  stale: boolean;
}

/** Last-resort prices, used only when nothing was ever cached. Never cached themselves. */
const FALLBACK_PRICES: PriceData = {
  ethEur: 2800,
  solEur: 120,
  btcEur: 55000,
  trxEur: 0.22,
  tonEur: 3.5,
  usdtEur: 0.92,
  ethChange24h: 0,
  solChange24h: 0,
  btcChange24h: 0,
  trxChange24h: 0,
  tonChange24h: 0,
  priceUpdatedAt: 0,
  fetchedAt: 0,
  usdPerEur: null,
  stale: true,
};

// ─── Storage helpers (every access guarded: private mode, quota, SSR) ───────

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch { /* quota / private mode: cache is best effort */ }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;

// ─── Prices ─────────────────────────────────────────────────────────────────

const PRICE_FIELDS = ['ethEur', 'solEur', 'btcEur', 'trxEur', 'tonEur', 'usdtEur'] as const;

/** A sane EUR→USD multiplier, or null. */

/**
 * CoinGecko body → prices. Throws unless every coin has a numeric EUR price
 * (a 429 body like {status:{error_code:429}} has none).
 */
function parsePrices(data: unknown, now: number): PriceData {
  const d = (data ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const eur = (id: (typeof PRICE_IDS)[number]): number => {
    const v = d[id]?.eur;
    if (!positive(v)) throw new Error(`coingecko: no EUR price for ${id}`);
    return v;
  };
  const change = (id: (typeof PRICE_IDS)[number]): number => {
    const v = d[id]?.eur_24h_change;
    return finite(v) ? v : 0;
  };
  const updated = (id: (typeof PRICE_IDS)[number]): number => {
    const v = d[id]?.last_updated_at;
    return finite(v) ? v : 0;
  };
  const btcEur = eur('bitcoin');
  const btcUsd = d.bitcoin?.usd;
  return {
    ethEur:  eur('ethereum'),
    solEur:  eur('solana'),
    btcEur,
    trxEur:  eur('tron'),
    tonEur:  eur('the-open-network'),
    usdtEur: eur('tether'),
    ethChange24h: change('ethereum'),
    solChange24h: change('solana'),
    btcChange24h: change('bitcoin'),
    trxChange24h: change('tron'),
    tonChange24h: change('the-open-network'),
    priceUpdatedAt: Math.max(...PRICE_IDS.filter((id) => id !== 'tether').map(updated)) * 1000,
    fetchedAt: now,
    usdPerEur: positive(btcUsd) ? usdPerEurOrNull(btcUsd / btcEur) : null,
    stale: false,
  };
}

/** The cached prices if the entry is complete and well-formed, else null. */
function readPriceCache(): PriceData | null {
  const c = readJson(PRICE_CACHE_KEY) as Partial<PriceData> | null;
  if (!c || typeof c !== 'object') return null;
  if (!PRICE_FIELDS.every((f) => positive(c[f])) || !finite(c.fetchedAt)) return null;
  return {
    ethEur: c.ethEur!, solEur: c.solEur!, btcEur: c.btcEur!, trxEur: c.trxEur!, tonEur: c.tonEur!, usdtEur: c.usdtEur!,
    ethChange24h: finite(c.ethChange24h) ? c.ethChange24h : 0,
    solChange24h: finite(c.solChange24h) ? c.solChange24h : 0,
    btcChange24h: finite(c.btcChange24h) ? c.btcChange24h : 0,
    trxChange24h: finite(c.trxChange24h) ? c.trxChange24h : 0,
    tonChange24h: finite(c.tonChange24h) ? c.tonChange24h : 0,
    priceUpdatedAt: finite(c.priceUpdatedAt) ? c.priceUpdatedAt : c.fetchedAt!,
    fetchedAt: c.fetchedAt!,
    usdPerEur: usdPerEurOrNull(c.usdPerEur),
    stale: false,
  };
}

function writePriceCache(p: PriceData): void {
  writeJson(PRICE_CACHE_KEY, { ...p, stale: undefined }); // `stale` is per read, not stored
  try {
    storage()?.removeItem(LEGACY_PRICE_CACHE_KEY);
  } catch { /* ignore */ }
  try {
    window.dispatchEvent(new Event(PRICES_UPDATED_EVENT));
  } catch { /* SSR / old WebView */ }
}


/**
 * Second keyless price source: Kraken public ticker, one call for all six
 * coins plus EUR/USD, CORS allowed. CoinGecko's free API answers 429 quickly
 * for users behind shared mobile IPs; without a second source every such user
 * saw stale or built-in prices.
 */
export const KRAKEN_TICKER_URL =
  'https://api.kraken.com/0/public/Ticker?pair=XBTEUR,ETHEUR,SOLEUR,TRXEUR,TONEUR,USDTEUR,EURUSD';

/** Kraken names some pairs with X/Z prefixes (XXBTZEUR); match both forms. */
const KRAKEN_PAIRS = {
  btcEur:  ['XXBTZEUR', 'XBTEUR'],
  ethEur:  ['XETHZEUR', 'ETHEUR'],
  solEur:  ['SOLEUR'],
  trxEur:  ['TRXEUR'],
  tonEur:  ['TONEUR'],
  usdtEur: ['USDTEUR'],
  eurUsd:  ['ZEURZUSD', 'EURUSD'],
} as const;

/**
 * Kraken body → prices. Throws unless every coin has a price. Kraken has no
 * rolling 24 h change, so the last known change is kept (0 without a cache).
 */
export function parseKrakenPrices(data: unknown, now: number, previous: PriceData | null): PriceData {
  const body = (data ?? {}) as { error?: unknown; result?: Record<string, { c?: unknown }> };
  if (Array.isArray(body.error) && body.error.length > 0) throw new Error('kraken: error');
  const result = body.result ?? {};
  const last = (names: readonly string[]): number => {
    for (const n of names) {
      const c = result[n]?.c;
      const v = Array.isArray(c) ? Number(c[0]) : NaN;
      if (positive(v)) return v;
    }
    throw new Error(`kraken: no price for ${names[0]}`);
  };
  let usdPerEur: number | null = null;
  try { usdPerEur = usdPerEurOrNull(last(KRAKEN_PAIRS.eurUsd)); } catch { /* optional */ }
  return {
    btcEur:  last(KRAKEN_PAIRS.btcEur),
    ethEur:  last(KRAKEN_PAIRS.ethEur),
    solEur:  last(KRAKEN_PAIRS.solEur),
    trxEur:  last(KRAKEN_PAIRS.trxEur),
    tonEur:  last(KRAKEN_PAIRS.tonEur),
    usdtEur: last(KRAKEN_PAIRS.usdtEur),
    ethChange24h: previous?.ethChange24h ?? 0,
    solChange24h: previous?.solChange24h ?? 0,
    btcChange24h: previous?.btcChange24h ?? 0,
    trxChange24h: previous?.trxChange24h ?? 0,
    tonChange24h: previous?.tonChange24h ?? 0,
    priceUpdatedAt: now,
    fetchedAt: now,
    usdPerEur,
    stale: false,
  };
}

async function refreshPrices(cached: PriceData | null): Promise<PriceData> {
  try {
    const res = await fetch(PRICES_URL);
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const prices = parsePrices(await res.json(), Date.now());
    writePriceCache(prices);
    return prices;
  } catch { /* fall through to Kraken */ }
  try {
    const res = await fetch(KRAKEN_TICKER_URL);
    if (!res.ok) throw new Error(`kraken ${res.status}`);
    const prices = parseKrakenPrices(await res.json(), Date.now(), cached);
    writePriceCache(prices); // complete real prices: safe to cache
    return prices;
  } catch {
    if (cached) return { ...cached, stale: true };
    return { ...FALLBACK_PRICES };
  }
}

let pricesInFlight: Promise<PriceData> | null = null;

/**
 * Fresh cache (within TTL) → as is. Otherwise one CoinGecko request (shared by
 * concurrent callers: several screens refresh together). Never rejects.
 */
export async function fetchPrices(): Promise<PriceData> {
  const cached = readPriceCache();
  if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) return cached;
  if (!pricesInFlight) {
    pricesInFlight = refreshPrices(cached).finally(() => { pricesInFlight = null; });
  }
  return pricesInFlight;
}

// ─── Individual chain balance fetchers (throw on failure, never a silent 0) ─

async function fetchEthNative(address: string): Promise<number> {
  if (!address) return 0;
  const wei = await getEthProvider().getBalance(address);
  return parseFloat(ethers.formatEther(wei));
}

async function fetchUsdtErc20(address: string): Promise<number> {
  if (!address) return 0;
  const contract = new ethers.Contract(USDT_ADDR, ERC20_ABI, getEthProvider());
  const raw: bigint = await contract.balanceOf(address);
  return parseFloat(ethers.formatUnits(raw, 6));
}

export interface BtcBalance {
  /** Confirmed balance, BTC. */
  confirmed: number;
  /** Incoming unconfirmed: max(0, mempool funded − mempool spent), BTC. */
  pending: number;
}

function parseBtcAddressStats(data: unknown): BtcBalance {
  const d = data as {
    chain_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown };
    mempool_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown };
  } | null;
  const funded = d?.chain_stats?.funded_txo_sum;
  const spent = d?.chain_stats?.spent_txo_sum;
  if (!finite(funded) || !finite(spent)) throw new Error('btc api: malformed body');
  const mFunded = d?.mempool_stats?.funded_txo_sum;
  const mSpent = d?.mempool_stats?.spent_txo_sum;
  const pendingSats = finite(mFunded) && finite(mSpent) ? Math.max(0, mFunded - mSpent) : 0;
  return { confirmed: (funded - spent) / 1e8, pending: pendingSats / 1e8 };
}

/** blockstream.info, then mempool.space. Throws when both fail. */
export async function fetchBtcBalance(address: string): Promise<BtcBalance> {
  if (!address) return { confirmed: 0, pending: 0 };
  let lastError: unknown = new Error('btc: no API answered');
  for (const base of BTC_ADDRESS_APIS) {
    try {
      const res = await fetch(`${base}${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error(`${base} ${res.status}`);
      return parseBtcAddressStats(await res.json());
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function fetchSolBalance(address: string): Promise<number> {
  if (!address) return 0;
  // Failover across browser-allowed RPCs and our proxy (lib/crypto/sol-rpc.ts);
  // any failure rejects, so the asset is reported unavailable, never a fake 0.
  const value = await solRpc<{ value?: unknown }>('getBalance', [address]);
  const lamports = value?.value;
  if (!finite(lamports)) throw new Error('solana rpc: malformed body');
  return lamports / 1e9; // lamports → SOL
}

// ─── Server proxy (provider keys stay server-side) ─────────────────────────

const NO_SERVER_BALANCES: BalancesResponse = { ton: null, usdtTon: null, trx: null, usdtTrc: null };

/** /api/balances; any failure (no session, 4xx/5xx, network) → all null → direct fallback. */
export async function fetchServerBalances(
  tonAddress: string,
  tronAddress: string,
): Promise<BalancesResponse> {
  if ((!tonAddress && !tronAddress) || typeof window === 'undefined') return NO_SERVER_BALANCES;
  try {
    // Lazy import: supabase.ts бросает без env — не тянем его в модуль при импорте.
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return NO_SERVER_BALANCES;
    const qs = new URLSearchParams();
    if (tonAddress) qs.set('ton', tonAddress);
    if (tronAddress) qs.set('tron', tronAddress);
    const res = await fetch(`/api/balances?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return NO_SERVER_BALANCES;
    const body = (await res.json()) as Partial<BalancesResponse>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { ton: num(body.ton), usdtTon: num(body.usdtTon), trx: num(body.trx), usdtTrc: num(body.usdtTrc) };
  } catch {
    return NO_SERVER_BALANCES;
  }
}

/** Server value if present, else the direct keyless fetch (which throws on failure). */
function serverOr(value: number | null, direct: () => Promise<number>): Promise<number> {
  return value !== null ? Promise.resolve(value) : direct();
}

// ─── Last good balances (per address set; numbers + timestamps only) ────────

type LastBalances = { k: string; b: Partial<Record<AssetSymbol, { v: number; t: number }>> };

/** Opaque key for the address set (addresses themselves are not stored). */
function addressSetKey(addresses: string[]): string {
  return ethers.id(addresses.join('|')).slice(2, 18);
}

function readLastBalances(key: string): LastBalances['b'] {
  const c = readJson(LAST_BALANCES_KEY) as LastBalances | null;
  if (!c || typeof c !== 'object' || c.k !== key || !c.b || typeof c.b !== 'object') return {};
  const out: LastBalances['b'] = {};
  for (const { symbol } of SUPPORTED_ASSETS) {
    const e = c.b[symbol];
    if (e && finite(e.v) && e.v >= 0 && finite(e.t)) out[symbol] = { v: e.v, t: e.t };
  }
  return out;
}

function writeLastBalances(key: string, prev: LastBalances['b'], fresh: Partial<Record<AssetSymbol, number>>, now: number): void {
  const b: LastBalances['b'] = { ...prev };
  for (const [symbol, v] of Object.entries(fresh) as Array<[AssetSymbol, number]>) b[symbol] = { v, t: now };
  writeJson(LAST_BALANCES_KEY, { k: key, b } satisfies LastBalances);
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Home, Assets, Send and the Neura chat each poll balances every 30 s on their
 * own. Without sharing, one open screen set made 3-4× the provider calls and
 * hit the keyless limits (toncenter 1 rps, TronGrid, public Solana RPC) with
 * 429s, which then showed up as "couldn't refresh". Concurrent callers for the
 * same address set share one request, and a result is reused for a few seconds.
 */
const BALANCES_REUSE_MS = 10_000;
const balancesShared = new Map<string, { promise: Promise<WalletBalances>; at: number }>();

/** Test hook: forget shared results. */
export function resetSharedBalances(): void {
  balancesShared.clear();
}

export function fetchRealBalances(
  ethAddress:  string,
  solAddress:  string,
  btcAddress   = '',
  tronAddress  = '',
  tonAddress   = '',
): Promise<WalletBalances> {
  const key = [ethAddress, solAddress, btcAddress, tronAddress, tonAddress].join('|');
  const now = Date.now();
  const hit = balancesShared.get(key);
  if (hit && now - hit.at < BALANCES_REUSE_MS) return hit.promise;
  const promise = fetchRealBalancesUncached(ethAddress, solAddress, btcAddress, tronAddress, tonAddress);
  balancesShared.set(key, { promise, at: now });
  // A rejected round must not be reused.
  promise.catch(() => { if (balancesShared.get(key)?.promise === promise) balancesShared.delete(key); });
  return promise;
}

async function fetchRealBalancesUncached(
  ethAddress:  string,
  solAddress:  string,
  btcAddress   = '',
  tronAddress  = '',
  tonAddress   = '',
): Promise<WalletBalances> {
  const pricesPromise = fetchPrices().catch(() => ({ ...FALLBACK_PRICES }));
  const server = await fetchServerBalances(tonAddress, tronAddress);
  const [ethR, usdtR, solR, btcR, trc20R, trxR, tonR, usdtTonR] = await Promise.allSettled([
    fetchEthNative(ethAddress),
    fetchUsdtErc20(ethAddress),
    fetchSolBalance(solAddress),
    fetchBtcBalance(btcAddress),
    tronAddress ? serverOr(server.usdtTrc, () => fetchUsdtTrc20Balance(tronAddress)) : Promise.resolve(0),
    tronAddress ? serverOr(server.trx,     () => fetchTrxBalance(tronAddress))        : Promise.resolve(0),
    tonAddress  ? serverOr(server.ton,     () => fetchTonBalance(tonAddress))         : Promise.resolve(0),
    tonAddress  ? serverOr(server.usdtTon, () => fetchUsdtTonBalance(tonAddress))     : Promise.resolve(0),
  ]);
  const priceData = await pricesPromise;

  const settled: Record<AssetSymbol, PromiseSettledResult<number>> = {
    BTC: btcR.status === 'fulfilled' ? { status: 'fulfilled', value: btcR.value.confirmed } : btcR,
    ETH: ethR,
    SOL: solR,
    USDT: usdtR,
    TRX: trxR,
    USDT_TRC: trc20R,
    TON: tonR,
    USDT_TON: usdtTonR,
  };

  const key = addressSetKey([ethAddress, solAddress, btcAddress, tronAddress, tonAddress]);
  const last = readLastBalances(key);
  const fresh: Partial<Record<AssetSymbol, number>> = {};
  const unavailable: AssetSymbol[] = [];
  const amount = {} as Record<AssetSymbol, number>;
  for (const { symbol } of SUPPORTED_ASSETS) {
    const r = settled[symbol];
    if (r.status === 'fulfilled' && finite(r.value)) {
      fresh[symbol] = r.value;
      amount[symbol] = r.value;
    } else {
      unavailable.push(symbol);
      amount[symbol] = last[symbol]?.v ?? 0;
    }
  }
  writeLastBalances(key, last, fresh, Date.now());

  return {
    eth:     amount.ETH,
    usdt:    amount.USDT,
    usdtTrc: amount.USDT_TRC,
    trx:     amount.TRX,
    usdtTon: amount.USDT_TON,
    sol:     amount.SOL,
    btc:     amount.BTC,
    ton:     amount.TON,
    ethEur:  priceData.ethEur,
    solEur:  priceData.solEur,
    btcEur:  priceData.btcEur,
    trxEur:  priceData.trxEur,
    tonEur:  priceData.tonEur,
    usdtEur: priceData.usdtEur,
    ethChange24h: priceData.ethChange24h,
    solChange24h: priceData.solChange24h,
    btcChange24h: priceData.btcChange24h,
    trxChange24h: priceData.trxChange24h,
    tonChange24h: priceData.tonChange24h,
    priceUpdatedAt: priceData.priceUpdatedAt,
    unavailable,
    pricesStale: priceData.stale,
    btcPending: btcR.status === 'fulfilled' && finite(btcR.value.pending) ? btcR.value.pending : 0,
    usdPerEur: priceData.usdPerEur,
  };
}

/** Display labels of the unavailable assets, e.g. ['ETH', 'USDT ERC-20']. */
export function unavailableLabels(b: Pick<WalletBalances, 'unavailable'>): string[] {
  return b.unavailable.map((s) => coinLabel(s === 'USDT_TRC' ? 'TRC20' : s));
}

export function totalPortfolioEur(b: WalletBalances): number {
  return (
    b.eth * b.ethEur +
    (b.usdt + b.usdtTrc + b.usdtTon) * b.usdtEur +
    b.trx * b.trxEur +
    b.sol * b.solEur +
    b.btc * b.btcEur +
    b.ton * b.tonEur
  );
}
