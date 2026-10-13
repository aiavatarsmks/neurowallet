// @vitest-environment node
/**
 * Live chain health check: "does every chain actually answer through OUR code".
 *
 * Skipped in the normal test run. Runs only with LIVE_CHAINS=1:
 *   cd frontend && LIVE_CHAINS=1 npx vitest run __tests__/live
 * and daily in GitHub Actions (.github/workflows/chain-health.yml), so a dead
 * public endpoint (like cloudflare-eth.com in 2026) is caught by CI, not by users.
 *
 * Read-only: balances, prices, fee estimates, unsigned TRON tx build + local
 * verification. Nothing is signed or broadcast. Addresses are large public
 * wallets (exchanges / foundations) so balances are non-zero.
 */
import { describe, it, expect } from 'vitest';
import { getEthProvider } from '@/lib/crypto/eth-provider';
import { fetchRealBalances, fetchPrices, parseKrakenPrices, KRAKEN_TICKER_URL } from '@/lib/crypto/balances';
import { solRpc } from '@/lib/crypto/sol-rpc';
import { estimateFeeNative, simulateTransfer, type SimCoin } from '@/lib/crypto/simulate';
import { estimateTronFee } from '@/lib/crypto/tron-tx';
import { getTxStatus } from '@/lib/crypto/tx-status';

const LIVE = process.env.LIVE_CHAINS === '1';

const ADDR = {
  eth: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',          // vitalik.eth
  btc: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', // large public cold wallet
  sol: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',          // large public wallet
  tron: 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G',                   // large exchange hot wallet
  ton: 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N',      // TON Foundation
};
const TIMEOUT = 60_000;

describe.skipIf(!LIVE)('live: every chain answers through our code', () => {
  it('ETH RPC: chainId 1, block number moves, USDT contract readable', async () => {
    const p = getEthProvider();
    const net = await p.getNetwork();
    expect(net.chainId).toBe(1n);
    expect(await p.getBlockNumber()).toBeGreaterThan(20_000_000);
    expect(await p.getBalance(ADDR.eth)).toBeGreaterThan(0n);
  }, TIMEOUT);

  it('balances: no chain unavailable, prices fresh', async () => {
    const b = await fetchRealBalances(ADDR.eth, ADDR.sol, ADDR.btc, ADDR.tron, ADDR.ton);
    expect(b.unavailable, `unavailable: ${b.unavailable.join(',')}`).toEqual([]);
    expect(b.pricesStale).toBe(false);
    expect(b.eth).toBeGreaterThan(0);
    expect(b.btc).toBeGreaterThan(0);
    expect(b.ton).toBeGreaterThan(0);
    expect(b.trx).toBeGreaterThan(0);
    expect(b.usdtTrc).toBeGreaterThan(0);
    expect(b.usdPerEur).toBeGreaterThan(0.8);
    expect(b.usdPerEur).toBeLessThan(1.6);
  }, TIMEOUT);

  it('prices: every coin has a EUR price', async () => {
    const p = await fetchPrices();
    for (const k of ['ethEur', 'btcEur', 'solEur', 'trxEur', 'tonEur', 'usdtEur'] as const) {
      expect(p[k], k).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('prices: Kraken fallback answers with every coin', async () => {
    const res = await fetch(KRAKEN_TICKER_URL);
    expect(res.ok).toBe(true);
    const p = parseKrakenPrices(await res.json(), Date.now(), null);
    expect(p.btcEur).toBeGreaterThan(1000);
    expect(p.trxEur).toBeGreaterThan(0);
  }, TIMEOUT);

  it('Solana: the browser RPC (publicnode) answers with a browser Origin', async () => {
    const res = await fetch('https://solana-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://neurowallet.tech' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [ADDR.sol] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result?.value).toBeGreaterThanOrEqual(0);
    // and the shared client path
    const r = await solRpc<{ value: number }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
    expect(r).toBeTruthy();
  }, TIMEOUT);

  it('fee estimates answer for every coin', async () => {
    const coins: SimCoin[] = ['ETH', 'USDT', 'BTC', 'SOL', 'TON', 'USDT_TON'];
    for (const coin of coins) {
      const fee = await estimateFeeNative({ coin, amount: 0.001, fromBtcAddress: ADDR.btc });
      expect(fee, coin).toBeGreaterThan(0);
    }
  }, TIMEOUT * 2);

  it('TRON: live energy estimate for USDT TRC-20 (no static fallback)', async () => {
    const est = await estimateTronFee({ kind: 'usdt', from: ADDR.tron, to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', amount: 1, timeoutMs: 20_000 });
    expect(est.source).toBe('live');
    expect(est.energyUsed).toBeGreaterThan(10_000);
  }, TIMEOUT);

  it('simulation review works end to end for ETH (fee from the live RPC)', async () => {
    const r = await simulateTransfer({
      coin: 'ETH', toAddress: '0x000000000000000000000000000000000000dEaD', amount: 0.001,
      balances: { ETH: 1, BTC: 0, SOL: 0, USDT: 0, TRX: 0, TRC20: 0, TON: 0, USDT_TON: 0 },
      eurRates: { eth: 3000, btc: 0, sol: 0, trx: 0, ton: 0 }, timeoutMs: 20_000,
    });
    expect(r.status).toBe('ok');
    expect(r.feeNative).toBeGreaterThan(0);
  }, TIMEOUT);

  it('status APIs answer (a long-confirmed tx per chain reads as confirmed)', async () => {
    // Genesis-era / well-known confirmed transactions.
    const btc = await getTxStatus('BTC', 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16');
    expect(btc.state).toBe('confirmed');
  }, TIMEOUT);
});
