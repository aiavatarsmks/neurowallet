import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTxStatus,
  TxStatusFetchError,
  TX_STATUS_REASON,
  SOL_EXPIRY_MS,
  BTC_NOT_FOUND_GRACE_MS,
} from '@/lib/crypto/tx-status';

const ETH_HASH = '0x' + 'ab'.repeat(32);
const HEX_TXID = 'cd'.repeat(32);
const SOL_SIG = '5'.repeat(88);
const TON_WALLET = 'EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3M-';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

const bodyOf = (fn: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(fn.mock.calls[i][1].body as string);

afterEach(() => vi.unstubAllGlobals());

describe('getTxStatus: ETH / USDT ERC-20 (eth_getTransactionReceipt)', () => {
  it('status 0x1 → confirmed', async () => {
    const f = stubFetch(json({ jsonrpc: '2.0', id: 1, result: { status: '0x1' } }));
    await expect(getTxStatus('USDT', ETH_HASH)).resolves.toEqual({ state: 'confirmed' });
    expect(f.mock.calls[0][0]).toBe('https://ethereum-rpc.publicnode.com');
    expect(bodyOf(f)).toMatchObject({ method: 'eth_getTransactionReceipt', params: [ETH_HASH] });
  });

  it('status 0x0 → failed (reverted)', async () => {
    stubFetch(json({ result: { status: '0x0' } }));
    await expect(getTxStatus('ETH', ETH_HASH)).resolves.toEqual({ state: 'failed', reason: TX_STATUS_REASON.ETH_REVERTED });
  });

  it('null receipt → pending', async () => {
    stubFetch(json({ result: null }));
    await expect(getTxStatus('ETH', ETH_HASH)).resolves.toEqual({ state: 'pending' });
  });

  it('primary RPC down / rate-limited → fallback 1rpc.io', async () => {
    const f = stubFetch(new TypeError('Failed to fetch'), json({ result: { status: '0x1' } }));
    await expect(getTxStatus('ETH', ETH_HASH)).resolves.toEqual({ state: 'confirmed' });
    expect(f.mock.calls[1][0]).toBe('https://1rpc.io/eth');

    const g = stubFetch(json({}, 429), json({ result: null }));
    await expect(getTxStatus('ETH', ETH_HASH)).resolves.toEqual({ state: 'pending' });
    expect(g).toHaveBeenCalledTimes(2);
  });

  it('both RPCs failing → TxStatusFetchError (poller backs off)', async () => {
    stubFetch(json({}, 503), new TypeError('offline'));
    await expect(getTxStatus('ETH', ETH_HASH)).rejects.toBeInstanceOf(TxStatusFetchError);
  });

  it('malformed hash never hits the network', async () => {
    const f = stubFetch();
    await expect(getTxStatus('ETH', '0x123')).resolves.toEqual({ state: 'unknown', reason: TX_STATUS_REASON.BAD_HASH });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('getTxStatus: BTC (blockstream, fallback mempool.space)', () => {
  it('confirmed:true → confirmed; in mempool → pending', async () => {
    const f = stubFetch(json({ confirmed: true, block_height: 900000 }));
    await expect(getTxStatus('BTC', HEX_TXID)).resolves.toEqual({ state: 'confirmed' });
    expect(f.mock.calls[0][0]).toBe(`https://blockstream.info/api/tx/${HEX_TXID}/status`);

    stubFetch(json({ confirmed: false }));
    await expect(getTxStatus('BTC', HEX_TXID)).resolves.toEqual({ state: 'pending' });
  });

  it('blockstream 5xx → mempool.space', async () => {
    const f = stubFetch(new Response('', { status: 502 }), json({ confirmed: true }));
    await expect(getTxStatus('BTC', HEX_TXID)).resolves.toEqual({ state: 'confirmed' });
    expect(f.mock.calls[1][0]).toBe(`https://mempool.space/api/tx/${HEX_TXID}/status`);
  });

  it('404 on both → pending in the first minutes, unknown afterwards', async () => {
    stubFetch(new Response('Transaction not found', { status: 404 }), new Response('', { status: 404 }));
    await expect(getTxStatus('BTC', HEX_TXID, { elapsedMs: 30_000 })).resolves.toEqual({ state: 'pending' });

    stubFetch(new Response('', { status: 404 }), new Response('', { status: 404 }));
    await expect(getTxStatus('BTC', HEX_TXID, { elapsedMs: BTC_NOT_FOUND_GRACE_MS + 1 }))
      .resolves.toEqual({ state: 'unknown', reason: TX_STATUS_REASON.BTC_NOT_FOUND });
  });

  it('both explorers unreachable → throws', async () => {
    stubFetch(new TypeError('offline'), new Response('', { status: 503 }));
    await expect(getTxStatus('BTC', HEX_TXID)).rejects.toBeInstanceOf(TxStatusFetchError);
  });

  it('a txid that is not 64 hex chars is not put into a URL', async () => {
    const f = stubFetch();
    await expect(getTxStatus('BTC', '../../evil')).resolves.toMatchObject({ state: 'unknown' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('getTxStatus: SOL (getSignatureStatuses)', () => {
  const statusResp = (value: unknown) => json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [value] } });

  it('asks with searchTransactionHistory and maps confirmed/finalized → confirmed', async () => {
    const f = stubFetch(statusResp({ err: null, confirmationStatus: 'finalized' }));
    await expect(getTxStatus('SOL', SOL_SIG)).resolves.toEqual({ state: 'confirmed' });
    expect(bodyOf(f)).toMatchObject({
      method: 'getSignatureStatuses',
      params: [[SOL_SIG], { searchTransactionHistory: true }],
    });
    stubFetch(statusResp({ err: null, confirmationStatus: 'confirmed' }));
    await expect(getTxStatus('SOL', SOL_SIG)).resolves.toEqual({ state: 'confirmed' });
  });

  it('processed → pending; err → failed', async () => {
    stubFetch(statusResp({ err: null, confirmationStatus: 'processed' }));
    await expect(getTxStatus('SOL', SOL_SIG)).resolves.toEqual({ state: 'pending' });
    stubFetch(statusResp({ err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'confirmed' }));
    await expect(getTxStatus('SOL', SOL_SIG)).resolves.toEqual({ state: 'failed', reason: TX_STATUS_REASON.SOL_ERROR });
  });

  it('null → pending at first, unknown (maybe expired) after ~2 min', async () => {
    stubFetch(statusResp(null));
    await expect(getTxStatus('SOL', SOL_SIG, { elapsedMs: 10_000 })).resolves.toEqual({ state: 'pending' });
    stubFetch(statusResp(null));
    await expect(getTxStatus('SOL', SOL_SIG, { elapsedMs: SOL_EXPIRY_MS })).resolves.toEqual({
      state: 'unknown',
      reason: TX_STATUS_REASON.SOL_MAYBE_EXPIRED,
    });
  });

  it('429 → TxStatusFetchError with the status', async () => {
    stubFetch(json({}, 429));
    await expect(getTxStatus('SOL', SOL_SIG)).rejects.toMatchObject({ name: 'TxStatusFetchError', status: 429 });
  });
});

describe('getTxStatus: TRON (gettransactioninfobyid)', () => {
  it('{} → pending (not in a block yet); request is POST {value: txid}', async () => {
    const f = stubFetch(json({}));
    await expect(getTxStatus('TRC20', HEX_TXID)).resolves.toEqual({ state: 'pending' });
    expect(f.mock.calls[0][0]).toBe('https://api.trongrid.io/wallet/gettransactioninfobyid');
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect(bodyOf(f)).toEqual({ value: HEX_TXID });
  });

  it('USDT TRC-20 OUT_OF_ENERGY → failed with the reason (TRX burned, transfer not done)', async () => {
    stubFetch(json({
      id: HEX_TXID,
      blockNumber: 61000000,
      fee: 13_000_000,
      result: 'FAILED',
      receipt: { energy_fee: 13_000_000, energy_usage_total: 65000, result: 'OUT_OF_ENERGY' },
      resMessage: '4f7574206f6620656e65726779',
    }));
    await expect(getTxStatus('TRC20', HEX_TXID)).resolves.toEqual({ state: 'failed', reason: 'OUT_OF_ENERGY' });
  });

  it('USDT TRC-20 REVERT → failed; SUCCESS → confirmed', async () => {
    stubFetch(json({ id: HEX_TXID, blockNumber: 1, result: 'FAILED', receipt: { result: 'REVERT' } }));
    await expect(getTxStatus('TRC20', HEX_TXID)).resolves.toEqual({ state: 'failed', reason: 'REVERT' });
    stubFetch(json({ id: HEX_TXID, blockNumber: 1, receipt: { energy_usage_total: 31895, result: 'SUCCESS' } }));
    await expect(getTxStatus('TRC20', HEX_TXID)).resolves.toEqual({ state: 'confirmed' });
  });

  it('native TRX: info with blockNumber → confirmed; result FAILED → failed', async () => {
    stubFetch(json({ id: HEX_TXID, blockNumber: 1, blockTimeStamp: 1, receipt: { net_usage: 268 } }));
    await expect(getTxStatus('TRX', HEX_TXID)).resolves.toEqual({ state: 'confirmed' });
    stubFetch(json({ id: HEX_TXID, blockNumber: 1, result: 'FAILED', receipt: {} }));
    await expect(getTxStatus('TRX', HEX_TXID)).resolves.toEqual({ state: 'failed', reason: 'FAILED' });
  });

  it('a chain code with odd characters is not passed through to the UI', async () => {
    stubFetch(json({ id: HEX_TXID, blockNumber: 1, result: 'FAILED', receipt: { result: '<script>' } }));
    await expect(getTxStatus('TRC20', HEX_TXID)).resolves.toEqual({ state: 'failed', reason: 'FAILED' });
  });

  it('TronGrid 429 → throws for backoff', async () => {
    stubFetch(json({ Error: 'rate limit' }, 429));
    await expect(getTxStatus('TRX', HEX_TXID)).rejects.toBeInstanceOf(TxStatusFetchError);
  });
});

describe('getTxStatus: TON / USDT-TON (wallet seqno)', () => {
  const seqnoResp = (hex: string, exit = 0) =>
    json({ ok: true, result: { '@type': 'smc.runResult', gas_used: 1, stack: [['num', hex]], exit_code: exit } });

  it('seqno moved past the sent one → confirmed (processed by the wallet)', async () => {
    const f = stubFetch(seqnoResp('0x6'));
    await expect(getTxStatus('USDT_TON', 'ton:seqno:5', { tonWalletAddress: TON_WALLET }))
      .resolves.toEqual({ state: 'confirmed' });
    expect(f.mock.calls[0][0]).toBe('https://toncenter.com/api/v2/runGetMethod');
    expect(bodyOf(f)).toEqual({ address: TON_WALLET, method: 'seqno', stack: [] });
  });

  it('seqno still equal → pending', async () => {
    stubFetch(seqnoResp('0x5'));
    await expect(getTxStatus('TON', 'ton:seqno:5', { tonWalletAddress: TON_WALLET })).resolves.toEqual({ state: 'pending' });
  });

  it('first send from an uninitialized wallet (get-method fails) → pending', async () => {
    stubFetch(json({ ok: true, result: { stack: [], exit_code: -13 } }));
    await expect(getTxStatus('TON', 'ton:seqno:0', { tonWalletAddress: TON_WALLET })).resolves.toEqual({ state: 'pending' });
  });

  it('no wallet address or not a seqno reference → unknown, no request', async () => {
    const f = stubFetch();
    await expect(getTxStatus('TON', 'ton:seqno:5')).resolves.toEqual({ state: 'unknown', reason: TX_STATUS_REASON.TON_NO_WALLET });
    await expect(getTxStatus('TON', 'abc', { tonWalletAddress: TON_WALLET })).resolves.toMatchObject({ state: 'unknown' });
    expect(f).not.toHaveBeenCalled();
  });

  it('toncenter rate limit → throws for backoff', async () => {
    stubFetch(json({ ok: false, error: 'Ratelimit exceed', code: 429 }, 429));
    await expect(getTxStatus('TON', 'ton:seqno:5', { tonWalletAddress: TON_WALLET })).rejects.toBeInstanceOf(TxStatusFetchError);
  });
});
