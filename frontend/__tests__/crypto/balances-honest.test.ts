import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks: no live network ───────────────────────────────────────────────────

const eth = vi.hoisted(() => ({
  getBalance: vi.fn<(addr: string) => Promise<bigint>>(),
  call: vi.fn<(tx: unknown) => Promise<string>>(),
}));
vi.mock('@/lib/crypto/eth-provider', () => ({ getEthProvider: () => eth }));

const tron = vi.hoisted(() => ({
  fetchUsdtTrc20Balance: vi.fn<(a: string) => Promise<number>>(),
  fetchTrxBalance: vi.fn<(a: string) => Promise<number>>(),
}));
vi.mock('@/lib/crypto/tron-tx', () => tron);

const ton = vi.hoisted(() => ({
  fetchTonBalance: vi.fn<(a: string) => Promise<number>>(),
  fetchUsdtTonBalance: vi.fn<(a: string) => Promise<number>>(),
}));
vi.mock('@/lib/crypto/ton-tx', () => ton);

// No Supabase session → /api/balances is skipped → direct fetchers are used.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import {
  fetchRealBalances,
  resetSharedBalances,
  fetchPrices,
  fetchBtcBalance,
  fetchSolBalance,
  getCachedUsdPerEur,
  unavailableLabels,
  PRICES_UPDATED_EVENT,
} from '@/lib/crypto/balances';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADDR = {
  eth: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  sol: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
  btc: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  tron: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
  ton: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',
};
const fetchAll = () => fetchRealBalances(ADDR.eth, ADDR.sol, ADDR.btc, ADDR.tron, ADDR.ton);

const COINGECKO_OK = {
  ethereum: { eur: 3000, usd: 3489, eur_24h_change: 1.5, last_updated_at: 1_760_000_000 },
  solana: { eur: 150, usd: 174.45, eur_24h_change: -2, last_updated_at: 1_760_000_000 },
  bitcoin: { eur: 100_000, usd: 116_300, eur_24h_change: 0.5, last_updated_at: 1_760_000_001 },
  tron: { eur: 0.3, usd: 0.35, eur_24h_change: 0, last_updated_at: 1_760_000_000 },
  'the-open-network': { eur: 2.5, usd: 2.91, eur_24h_change: 3, last_updated_at: 1_760_000_000 },
  tether: { eur: 0.86, usd: 1.0, eur_24h_change: 0, last_updated_at: 1_760_000_000 },
};
const COINGECKO_429 = { status: { error_code: 429, error_message: "You've exceeded the Rate Limit." } };
const BTC_STATS = {
  chain_stats: { funded_txo_sum: 150_000_000, spent_txo_sum: 50_000_000 },
  mempool_stats: { funded_txo_sum: 120_000, spent_txo_sum: 0 },
};

type Route = { status?: number; body?: unknown; throws?: boolean };
let routes: Record<string, Route>;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const key = Object.keys(routes).find((k) => url.includes(k));
  const r = key ? routes[key] : { throws: true };
  if (r.throws) throw new TypeError('Failed to fetch');
  const status = r.status ?? 200;
  return { ok: status >= 200 && status < 300, status, json: async () => r.body } as Response;
});

const USDT_RAW = '0x' + (25_500_000n).toString(16).padStart(64, '0'); // 25.5 USDT (6 decimals)

beforeEach(() => {
  localStorage.clear();
  resetSharedBalances();
  routes = {
    'api.coingecko.com': { body: COINGECKO_OK },
    'blockstream.info': { body: BTC_STATS },
    'mempool.space': { body: BTC_STATS },
    'solana-rpc.publicnode.com': { body: { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 2_500_000_000 } } },
  };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  eth.getBalance.mockReset().mockResolvedValue(2n * 10n ** 18n);
  eth.call.mockReset().mockResolvedValue(USDT_RAW);
  tron.fetchTrxBalance.mockReset().mockResolvedValue(100);
  tron.fetchUsdtTrc20Balance.mockReset().mockResolvedValue(40);
  ton.fetchTonBalance.mockReset().mockResolvedValue(7);
  ton.fetchUsdtTonBalance.mockReset().mockResolvedValue(0); // undeployed jetton wallet = real 0
});

afterEach(() => vi.unstubAllGlobals());

// ─── fetchRealBalances: unavailable + last good value ────────────────────────

describe('fetchRealBalances: honest per-asset failures', () => {
  it('all providers answer → fresh numbers, nothing unavailable, BTC pending separate', async () => {
    const b = await fetchAll();
    expect(b).toMatchObject({
      eth: 2, usdt: 25.5, sol: 2.5, btc: 1, trx: 100, usdtTrc: 40, ton: 7, usdtTon: 0,
      unavailable: [], pricesStale: false, btcPending: 0.0012,
    });
    expect(b.usdPerEur).toBeCloseTo(1.163, 3);
  });

  it('a failed fetcher is listed and shows 0 only when there is no last good value', async () => {
    eth.getBalance.mockRejectedValue(new Error('all ETH RPCs down'));
    const b = await fetchAll();
    expect(b.unavailable).toEqual(['ETH']);
    expect(b.eth).toBe(0);
    expect(b.usdt).toBe(25.5); // USDT ERC-20 is its own asset
  });

  it('a failed fetcher shows the last good value from the previous round', async () => {
    await fetchAll(); // round 1: everything fresh, cached
    resetSharedBalances(); // next poll, past the shared-result window
    eth.getBalance.mockRejectedValue(new Error('down'));
    tron.fetchTrxBalance.mockRejectedValue(new Error('trongrid 429'));
    ton.fetchTonBalance.mockRejectedValue(new Error('toncenter 429'));
    const b = await fetchAll();
    expect(b.unavailable).toEqual(['ETH', 'TRX', 'TON']);
    expect(b).toMatchObject({ eth: 2, trx: 100, ton: 7, usdtTrc: 40 });
  });

  it('the last-good cache is per address set and stores no addresses or secrets', async () => {
    await fetchAll();
    const raw = localStorage.getItem('nw_last_balances_v1') ?? '';
    for (const a of Object.values(ADDR)) expect(raw).not.toContain(a);
    expect(raw).not.toMatch(/0x[0-9a-fA-F]{40}/);

    eth.getBalance.mockRejectedValue(new Error('down'));
    const other = await fetchRealBalances('0x' + '1'.repeat(40), ADDR.sol, ADDR.btc, ADDR.tron, ADDR.ton);
    expect(other.unavailable).toContain('ETH');
    expect(other.eth).toBe(0); // another wallet's last value is not reused
  });

  it('SOL JSON-RPC error, malformed body and HTTP 429 are failures, not 0', async () => {
    for (const r of [
      { body: { jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'rate limited' } } },
      { body: { jsonrpc: '2.0', id: 1, result: {} } },
      { status: 429, body: {} },
    ]) {
      routes['solana-rpc.publicnode.com'] = r;
      await expect(fetchSolBalance(ADDR.sol)).rejects.toThrow();
    }
    const b = await fetchAll();
    expect(b.unavailable).toEqual(['SOL']);
  });

  it('an empty SOL account is a real 0', async () => {
    routes['solana-rpc.publicnode.com'] = { body: { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 0 } } };
    expect(await fetchSolBalance(ADDR.sol)).toBe(0);
  });

  it('BTC falls back to mempool.space when blockstream fails', async () => {
    routes['blockstream.info'] = { status: 503, body: {} };
    expect(await fetchBtcBalance(ADDR.btc)).toEqual({ confirmed: 1, pending: 0.0012 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('https://mempool.space/api/address/'))).toBe(true);
  });

  it('BTC unavailable only when both APIs fail; pending ignores outgoing (spent) mempool', async () => {
    routes['blockstream.info'] = { throws: true };
    routes['mempool.space'] = { body: { chain_stats: {} } };
    await expect(fetchBtcBalance(ADDR.btc)).rejects.toThrow();
    const b = await fetchAll();
    expect(b.unavailable).toEqual(['BTC']);
    expect(b.btcPending).toBe(0);

    routes['blockstream.info'] = { body: { ...BTC_STATS, mempool_stats: { funded_txo_sum: 10_000, spent_txo_sum: 50_000 } } };
    expect((await fetchBtcBalance(ADDR.btc)).pending).toBe(0);
  });

  it('TRON / TON fetcher rejections become unavailable (no silent 0)', async () => {
    tron.fetchUsdtTrc20Balance.mockRejectedValue(new Error('trongrid down'));
    ton.fetchUsdtTonBalance.mockRejectedValue(new Error('toncenter 429'));
    const b = await fetchAll();
    expect(b.unavailable).toEqual(['USDT_TRC', 'USDT_TON']);
    expect(unavailableLabels(b)).toEqual(['USDT TRC-20', 'USDT TON']);
  });

  it('assets without an address are a real 0, not unavailable', async () => {
    const b = await fetchRealBalances(ADDR.eth, ADDR.sol);
    expect(b.unavailable).toEqual([]);
    expect(b).toMatchObject({ btc: 0, trx: 0, ton: 0 });
    expect(tron.fetchTrxBalance).not.toHaveBeenCalled();
  });

  it('works when localStorage throws (private mode)', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    eth.getBalance.mockRejectedValue(new Error('down'));
    const b = await fetchAll();
    expect(b.unavailable).toEqual(['ETH']);
    expect(b.eth).toBe(0);
    get.mockRestore();
    set.mockRestore();
  });
});

// ─── Prices ───────────────────────────────────────────────────────────────────

const PRICE_CACHE = 'nw_prices_cache_v2';

describe('fetchPrices: fresh vs stale, fallback never cached', () => {
  it('fresh answer: EUR prices, live usdPerEur, cached, event fired', async () => {
    const onEvent = vi.fn();
    window.addEventListener(PRICES_UPDATED_EVENT, onEvent);
    const p = await fetchPrices();
    window.removeEventListener(PRICES_UPDATED_EVENT, onEvent);
    expect(p).toMatchObject({ ethEur: 3000, btcEur: 100_000, usdtEur: 0.86, stale: false });
    expect(p.usdPerEur).toBeCloseTo(1.163, 3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('vs_currencies=eur,usd');
    expect(JSON.parse(localStorage.getItem(PRICE_CACHE) ?? '{}').ethEur).toBe(3000);
    expect(getCachedUsdPerEur()).toBeCloseTo(1.163, 3);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('within the TTL the cache is used without a request', async () => {
    await fetchPrices();
    fetchMock.mockClear();
    const p = await fetchPrices();
    expect(p.stale).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CoinGecko 429 with no cache → constants, stale, and nothing is cached', async () => {
    routes['api.coingecko.com'] = { status: 429, body: COINGECKO_429 };
    const p = await fetchPrices();
    expect(p.stale).toBe(true);
    expect(p.btcEur).toBe(55000);
    expect(localStorage.getItem(PRICE_CACHE)).toBeNull();
  });

  it('a 429 body served with HTTP 200 (no .eur) is not cached either', async () => {
    routes['api.coingecko.com'] = { body: COINGECKO_429 };
    expect((await fetchPrices()).stale).toBe(true);
    expect(localStorage.getItem(PRICE_CACHE)).toBeNull();
  });

  it('partial data (one coin missing) is rejected as a whole', async () => {
    const { tron: _drop, ...partial } = COINGECKO_OK;
    void _drop;
    routes['api.coingecko.com'] = { body: partial };
    const p = await fetchPrices();
    expect(p.stale).toBe(true);
    expect(localStorage.getItem(PRICE_CACHE)).toBeNull();
  });

  it('refresh fails after the TTL → last cached prices, marked stale', async () => {
    localStorage.setItem(PRICE_CACHE, JSON.stringify({
      ...{ ethEur: 3100, solEur: 160, btcEur: 98_000, trxEur: 0.31, tonEur: 2.6, usdtEur: 0.87 },
      fetchedAt: Date.now() - 3_600_000, priceUpdatedAt: 0, usdPerEur: 1.15,
    }));
    routes['api.coingecko.com'] = { status: 429, body: COINGECKO_429 };
    const p = await fetchPrices();
    expect(p).toMatchObject({ ethEur: 3100, btcEur: 98_000, usdPerEur: 1.15, stale: true });
    expect(JSON.parse(localStorage.getItem(PRICE_CACHE) ?? '{}').fetchedAt).toBeLessThan(Date.now() - 3_000_000); // untouched
  });

  it('fetchRealBalances reports pricesStale and the cached usdPerEur', async () => {
    routes['api.coingecko.com'] = { throws: true };
    const b = await fetchAll();
    expect(b.pricesStale).toBe(true);
    expect(b.usdPerEur).toBeNull();
  });

  it('ignores the v1 cache that may hold fallback constants written as fresh', async () => {
    localStorage.setItem('nw_prices_cache', JSON.stringify({ ethEur: 2800, solEur: 120, btcEur: 55000, trxEur: 0.22, tonEur: 3.5, usdtEur: 0.92, fetchedAt: Date.now() }));
    const p = await fetchPrices();
    expect(p.btcEur).toBe(100_000);
    expect(localStorage.getItem('nw_prices_cache')).toBeNull();
  });
});

// ─── TON fetchers (real module): 429 is a failure, not 0 ─────────────────────

describe('ton-tx balance fetchers', () => {
  it('fetchTonBalance rejects on toncenter 429 / error body and parses a good answer', async () => {
    const real = await vi.importActual<typeof import('@/lib/crypto/ton-tx')>('@/lib/crypto/ton-tx');
    routes = { 'toncenter.com': { status: 429, body: { ok: false, error: 'Ratelimit exceed', code: 429 } } };
    await expect(real.fetchTonBalance(ADDR.ton)).rejects.toThrow(/429/);
    routes = { 'toncenter.com': { body: { ok: false, error: 'boom' } } };
    await expect(real.fetchTonBalance(ADDR.ton)).rejects.toThrow();
    routes = { 'toncenter.com': { body: { ok: true, result: 'not-a-number' } } };
    await expect(real.fetchTonBalance(ADDR.ton)).rejects.toThrow();
    routes = { 'toncenter.com': { body: { ok: true, result: '2500000000' } } };
    expect(await real.fetchTonBalance(ADDR.ton)).toBe(2.5);
    routes = { 'toncenter.com': { body: { ok: true, result: '0' } } };
    expect(await real.fetchTonBalance(ADDR.ton)).toBe(0); // empty account = real 0
  });
});

describe('fetchRealBalances: shared between screens', () => {
  it('concurrent callers for the same wallet share one round of provider calls', async () => {
    const [a, b, c] = await Promise.all([fetchAll(), fetchAll(), fetchAll()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(eth.getBalance).toHaveBeenCalledTimes(1);
    expect(tron.fetchTrxBalance).toHaveBeenCalledTimes(1);
  });
  it('a different wallet is not served from the shared result', async () => {
    await fetchAll();
    await fetchRealBalances('0x' + '2'.repeat(40), ADDR.sol, ADDR.btc, ADDR.tron, ADDR.ton);
    expect(eth.getBalance).toHaveBeenCalledTimes(2);
  });
});

describe('prices: Kraken fallback when CoinGecko rate-limits', () => {
  const KRAKEN_OK = {
    error: [],
    result: {
      XXBTZEUR: { c: ['74753.3', '0.1'] }, XETHZEUR: { c: ['2262.61', '1'] }, SOLEUR: { c: ['96.8', '1'] },
      TRXEUR: { c: ['0.294718', '1'] }, TONEUR: { c: ['1.233', '1'] }, USDTEUR: { c: ['0.8934', '1'] },
      ZEURZUSD: { c: ['1.1181', '1'] },
    },
  };
  it('CoinGecko 429 → Kraken prices, fresh, cached, with EUR/USD', async () => {
    routes['api.coingecko.com'] = { status: 429, body: COINGECKO_429 };
    routes['api.kraken.com'] = { body: KRAKEN_OK };
    const p = await fetchPrices();
    expect(p).toMatchObject({ btcEur: 74753.3, ethEur: 2262.61, trxEur: 0.294718, tonEur: 1.233, usdtEur: 0.8934, usdPerEur: 1.1181, stale: false });
    expect(JSON.parse(localStorage.getItem(PRICE_CACHE) ?? '{}').btcEur).toBe(74753.3);
  });
  it('Kraken missing a coin → not cached, stale path', async () => {
    routes['api.coingecko.com'] = { status: 429, body: COINGECKO_429 };
    const partial = { error: [], result: { ...KRAKEN_OK.result, TRXEUR: undefined } };
    routes['api.kraken.com'] = { body: partial };
    const p = await fetchPrices();
    expect(p.stale).toBe(true);
    expect(localStorage.getItem(PRICE_CACHE)).toBeNull();
  });
});
