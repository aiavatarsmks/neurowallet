/**
 * lib/crypto/balances.ts
 * Real blockchain balance fetching via public RPC endpoints and CoinGecko.
 * ETH/SOL/BTC/prices: client-side, keyless. TON/USDT-TON and TRX/USDT-TRC20:
 * first via /api/balances (server-side provider keys, never in the bundle),
 * per-chain fallback to the direct keyless call when the server has no key
 * or fails.
 */

import { ethers } from 'ethers';
import { fetchUsdtTrc20Balance, fetchTrxBalance } from './tron-tx';
import { fetchTonBalance, fetchUsdtTonBalance } from './ton-tx';
import type { BalancesResponse } from '@/lib/balances-types';

const ETH_RPC    = 'https://cloudflare-eth.com';
const SOL_RPC    = 'https://api.mainnet-beta.solana.com';
const USDT_ADDR  = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // ERC-20 Mainnet
const ERC20_ABI  = ['function balanceOf(address) view returns (uint256)'];
const PRICES_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,bitcoin,tron,the-open-network,tether&vs_currencies=eur&include_24hr_change=true&include_last_updated_at=true';

const PRICE_CACHE_KEY = 'nw_prices_cache';
export const MARKET_REFRESH_MS = 30_000; // near-real-time without hammering public APIs
const PRICE_TTL_MS    = MARKET_REFRESH_MS;

export interface WalletBalances {
  eth:      number;
  usdt:     number;   // ERC-20
  usdtTrc:  number;   // TRC-20
  trx:      number;
  usdtTon:  number;   // TON Jetton
  sol:      number;
  btc:      number;
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
}

// ─── Price fetching with localStorage cache ────────────────────────────────

export async function fetchPrices(): Promise<PriceData> {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (raw) {
      const cached: PriceData = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt < PRICE_TTL_MS) {
        return {
          ...cached,
          ethChange24h: cached.ethChange24h ?? 0,
          solChange24h: cached.solChange24h ?? 0,
          btcChange24h: cached.btcChange24h ?? 0,
          trxChange24h: cached.trxChange24h ?? 0,
          tonChange24h: cached.tonChange24h ?? 0,
          usdtEur: cached.usdtEur ?? 0.92,
          priceUpdatedAt: cached.priceUpdatedAt ?? cached.fetchedAt,
        };
      }
    }
  }

  try {
    const res  = await fetch(PRICES_URL);
    const data = await res.json();
    const prices: PriceData = {
      ethEur:    data.ethereum?.eur            ?? 2800,
      solEur:    data.solana?.eur              ?? 120,
      btcEur:    data.bitcoin?.eur             ?? 55000,
      trxEur:    data.tron?.eur      ?? 0.22,
      tonEur:    data['the-open-network']?.eur  ?? 3.5,
      usdtEur:   data.tether?.eur              ?? 0.92,
      ethChange24h: data.ethereum?.eur_24h_change ?? 0,
      solChange24h: data.solana?.eur_24h_change ?? 0,
      btcChange24h: data.bitcoin?.eur_24h_change ?? 0,
      trxChange24h: data.tron?.eur_24h_change ?? 0,
      tonChange24h: data['the-open-network']?.eur_24h_change ?? 0,
      priceUpdatedAt: Math.max(
        data.ethereum?.last_updated_at ?? 0,
        data.solana?.last_updated_at ?? 0,
        data.bitcoin?.last_updated_at ?? 0,
        data.tron?.last_updated_at ?? 0,
        data['the-open-network']?.last_updated_at ?? 0,
      ) * 1000,
      fetchedAt: Date.now(),
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(prices));
    }
    return prices;
  } catch {
    return {
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
    };
  }
}

// ─── Individual chain balance fetchers ────────────────────────────────────

async function fetchEthBalance(address: string): Promise<{ eth: number; usdt: number }> {
  const provider = new ethers.JsonRpcProvider(ETH_RPC);
  const [balWei, usdtBalance] = await Promise.all([
    provider.getBalance(address),
    fetchUsdtBalance(provider, address),
  ]);
  return { eth: parseFloat(ethers.formatEther(balWei)), usdt: usdtBalance };
}

async function fetchUsdtBalance(
  provider: ethers.JsonRpcProvider,
  address: string,
): Promise<number> {
  try {
    const contract = new ethers.Contract(USDT_ADDR, ERC20_ABI, provider);
    const balance  = await contract.balanceOf(address);
    return parseFloat(ethers.formatUnits(balance, 6));
  } catch {
    return 0;
  }
}

async function fetchBtcBalance(address: string): Promise<number> {
  if (!address) return 0;
  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!res.ok) return 0;
    const data = await res.json();
    const sats =
      (data.chain_stats?.funded_txo_sum ?? 0) -
      (data.chain_stats?.spent_txo_sum  ?? 0);
    return sats / 1e8;
  } catch {
    return 0;
  }
}

async function fetchSolBalance(address: string): Promise<number> {
  try {
    const res = await fetch(SOL_RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
    });
    const json = await res.json();
    return (json.result?.value ?? 0) / 1e9; // lamports → SOL
  } catch {
    return 0;
  }
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

/** Server value if present, else the direct keyless fetch (previous behaviour). */
function serverOr(value: number | null, direct: () => Promise<number>): Promise<number> {
  return value !== null ? Promise.resolve(value) : direct();
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function fetchRealBalances(
  ethAddress:  string,
  solAddress:  string,
  btcAddress   = '',
  tronAddress  = '',
  tonAddress   = '',
): Promise<WalletBalances> {
  const server = await fetchServerBalances(tonAddress, tronAddress);
  const [ethResult, solResult, btcResult, trc20Result, trxResult, tonResult, usdtTonResult, prices] =
    await Promise.allSettled([
      fetchEthBalance(ethAddress),
      fetchSolBalance(solAddress),
      fetchBtcBalance(btcAddress),
      tronAddress ? serverOr(server.usdtTrc, () => fetchUsdtTrc20Balance(tronAddress)) : Promise.resolve(0),
      tronAddress ? serverOr(server.trx,     () => fetchTrxBalance(tronAddress))        : Promise.resolve(0),
      tonAddress  ? serverOr(server.ton,     () => fetchTonBalance(tonAddress))         : Promise.resolve(0),
      tonAddress  ? serverOr(server.usdtTon, () => fetchUsdtTonBalance(tonAddress))     : Promise.resolve(0),
      fetchPrices(),
    ]);

  const { eth, usdt } =
    ethResult.status === 'fulfilled' ? ethResult.value : { eth: 0, usdt: 0 };
  const sol      = solResult.status      === 'fulfilled' ? solResult.value      : 0;
  const btc      = btcResult.status      === 'fulfilled' ? btcResult.value      : 0;
  const usdtTrc  = trc20Result.status    === 'fulfilled' ? trc20Result.value    : 0;
  const trx      = trxResult.status      === 'fulfilled' ? trxResult.value      : 0;
  const ton      = tonResult.status      === 'fulfilled' ? tonResult.value      : 0;
  const usdtTon  = usdtTonResult.status  === 'fulfilled' ? usdtTonResult.value  : 0;
  const priceData =
    prices.status === 'fulfilled'
      ? prices.value
      : {
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
        };

  return {
    eth,
    usdt,
    usdtTrc,
    trx,
    usdtTon,
    sol,
    btc,
    ton,
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
  };
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
