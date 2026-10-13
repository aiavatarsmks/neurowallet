/**
 * BTC signing: deterministic PSBT build, fee-rate caps, the reviewed fee rate
 * reaching the signer, broadcast fallback, and the review's vsize model.
 * All network calls are mocked; the key is a fixed test scalar (never funded).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { secp256k1 } from '@noble/curves/secp256k1';

const H = vi.hoisted(() => ({ decryptBytes: vi.fn() }));
vi.mock('@/lib/crypto/aes', () => ({ decryptBytes: H.decryptBytes }));

import {
  buildSignedTx,
  broadcastBtcTx,
  btcSegwitAddressFromPrivKey,
  planBtcTx,
  sendBtc,
  btcToSats,
  BTC_MAX_FEE_RATE_SAT_VB,
  type UTXO,
} from '@/lib/crypto/btc-tx';
import { estimateBtcFee, simulateTransfer, type SimCoin } from '@/lib/crypto/simulate';

const NET = bitcoin.networks.bitcoin;
const PRIV = new Uint8Array(32).fill(1);
const PUB = Buffer.from(secp256k1.getPublicKey(PRIV, true));
const FROM_WPKH = btcSegwitAddressFromPrivKey(PRIV);
const FROM_PKH = bitcoin.payments.p2pkh({ pubkey: PUB, network: NET }).address!;
const TO_WPKH = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // BIP84 vector, 31 vB output
const TO_TR = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'; // BIP86 vector, 43 vB output

const utxo = (txid: string, vout: number, value: number): UTXO => ({ txid, vout, value, status: { confirmed: true } });
const UTXOS: UTXO[] = [utxo('aa'.repeat(32), 0, 50_000), utxo('bb'.repeat(32), 1, 30_000)];

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const script = (addr: string) => hex(bitcoin.address.toOutputScript(addr, NET));
const sumOut = (tx: bitcoin.Transaction) => tx.outs.reduce((s, o) => s + o.value, 0n);

function textResponse(body: string, status = 200) {
  return new Response(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('planBtcTx + buildSignedTx: deterministic P2WPKH build', () => {
  it('selects UTXOs, pays exactly amount + change, fee = vsize estimate × rate', async () => {
    // 1 input: 11 + 68 + 31 + 31 = 141 vB → 1410 sat; 50 000 < 61 410 → add the 2nd.
    // 2 inputs: 11 + 136 + 62 = 209 vB → 2090 sat; change 80 000 − 60 000 − 2090.
    const plan = planBtcTx(UTXOS, 60_000n, 10, TO_WPKH, FROM_WPKH);
    expect(plan).toMatchObject({ totalIn: 80_000n, fee: 2_090n, change: 17_910n, vbytes: 209, feeRateSatVb: 10 });
    expect(plan.utxos.map((u) => u.value)).toEqual([50_000, 30_000]);

    const rawHex = await buildSignedTx(PRIV, UTXOS, TO_WPKH, FROM_WPKH, 60_000n, 10);
    const tx = bitcoin.Transaction.fromHex(rawHex);

    expect(tx.outs).toHaveLength(2);
    expect(tx.outs[0].value).toBe(60_000n);
    expect(hex(tx.outs[0].script)).toBe(script(TO_WPKH));
    expect(tx.outs[1].value).toBe(17_910n);
    expect(hex(tx.outs[1].script)).toBe(script(FROM_WPKH));
    expect(80_000n - sumOut(tx)).toBe(2_090n);

    expect(tx.ins.map((i) => hex(Buffer.from(i.hash).reverse()))).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
    // No RBF (owner decision): final sequence on every input.
    expect(tx.ins.every((i) => i.sequence === 0xffffffff)).toBe(true);
    // The estimate is an upper bound of the real size, so the real rate is ≥ 10 sat/vB.
    expect(tx.virtualSize()).toBeLessThanOrEqual(209);
    expect(tx.virtualSize()).toBeGreaterThanOrEqual(205);

    // RFC 6979 signatures: the same inputs give the same bytes.
    expect(await buildSignedTx(PRIV, UTXOS, TO_WPKH, FROM_WPKH, 60_000n, 10)).toBe(rawHex);
  });

  it('change at or below 546 sat is folded into the fee, no change output', async () => {
    // 1 input @ 2 sat/vB: 141 vB → 282 sat; rest 50 000 − 49 500 − 282 = 218 ≤ 546.
    const plan = planBtcTx([UTXOS[0]], 49_500n, 2, TO_WPKH, FROM_WPKH);
    expect(plan).toMatchObject({ change: 0n, fee: 500n });
    const tx = bitcoin.Transaction.fromHex(await buildSignedTx(PRIV, [UTXOS[0]], TO_WPKH, FROM_WPKH, 49_500n, 2));
    expect(tx.outs).toHaveLength(1);
    expect(50_000n - sumOut(tx)).toBe(500n);
  });

  it('taproot recipient is sized 43 vB', () => {
    expect(planBtcTx(UTXOS, 10_000n, 10, TO_TR, FROM_WPKH).vbytes).toBe(11 + 68 + 43 + 31);
  });
});

describe('legacy P2PKH source (148 vB inputs, full previous tx)', () => {
  it('builds with nonWitnessUtxo from the explorer and the 148 vB input size', async () => {
    const prev = new bitcoin.Transaction();
    prev.addInput(Buffer.alloc(32, 7), 0);
    prev.addOutput(bitcoin.address.toOutputScript(FROM_PKH, NET), 100_000n);
    const prevId = prev.getId();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`https://blockstream.info/api/tx/${prevId}/hex`);
      return textResponse(prev.toHex());
    });
    vi.stubGlobal('fetch', fetchMock);

    // 10 + 148 + 31 + 34 = 223 vB @ 5 → 1115 sat.
    const plan = planBtcTx([utxo(prevId, 0, 100_000)], 50_000n, 5, TO_WPKH, FROM_PKH);
    expect(plan).toMatchObject({ vbytes: 223, fee: 1_115n, change: 48_885n });

    const tx = bitcoin.Transaction.fromHex(
      await buildSignedTx(PRIV, [utxo(prevId, 0, 100_000)], TO_WPKH, FROM_PKH, 50_000n, 5),
    );
    expect(tx.outs.map((o) => o.value)).toEqual([50_000n, 48_885n]);
    expect(hex(tx.outs[1].script)).toBe(script(FROM_PKH));
    expect(100_000n - sumOut(tx)).toBe(1_115n);
    expect(tx.virtualSize()).toBeLessThanOrEqual(223);
  });
});

describe('fee caps at signing', () => {
  it(`refuses a fee rate above ${BTC_MAX_FEE_RATE_SAT_VB} sat/vB`, async () => {
    const big = [utxo('dd'.repeat(32), 0, 1_000_000)];
    await expect(buildSignedTx(PRIV, big, TO_WPKH, FROM_WPKH, 500_000n, 501))
      .rejects.toMatchObject({ code: 'BTC_FEE_RATE_TOO_HIGH' });
    // 141 vB × 500 = 70 500 sat: at the cap, and below half the amount.
    await expect(buildSignedTx(PRIV, big, TO_WPKH, FROM_WPKH, 500_000n, 500)).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('refuses a fee above 50% of the amount', async () => {
    // 1 input @ 10: 1410 sat fee for a 2000 sat payment.
    await expect(buildSignedTx(PRIV, UTXOS, TO_WPKH, FROM_WPKH, 2_000n, 10))
      .rejects.toMatchObject({ code: 'BTC_FEE_TOO_HIGH_VS_AMOUNT' });
    // 2820 sat: 1410 is exactly 50% → allowed.
    await expect(buildSignedTx(PRIV, UTXOS, TO_WPKH, FROM_WPKH, 2_820n, 10)).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('refuses a non-positive / non-finite fee rate', async () => {
    for (const rate of [0, -1, NaN, Infinity, 0.5]) {
      await expect(buildSignedTx(PRIV, UTXOS, TO_WPKH, FROM_WPKH, 60_000n, rate))
        .rejects.toMatchObject({ code: expect.stringMatching(/^BTC_(INVALID_FEE_RATE|FEE_RATE_TOO_HIGH)$/) });
    }
  });

  it('insufficient funds carry a code', () => {
    expect(() => planBtcTx(UTXOS, 79_000n, 10, TO_WPKH, FROM_WPKH)).toThrow(expect.objectContaining({ code: 'BTC_INSUFFICIENT_FUNDS' }));
    expect(() => planBtcTx([], 1_000n, 10, TO_WPKH, FROM_WPKH)).toThrow(expect.objectContaining({ code: 'BTC_NO_UTXO' }));
  });
});

describe('sendBtc: signs at the reviewed fee rate', () => {
  let keyCopy: Uint8Array;
  beforeEach(() => {
    H.decryptBytes.mockReset().mockImplementation(async () => {
      keyCopy = new Uint8Array(PRIV);
      return keyCopy;
    });
  });

  function chainFetch(opts: { hourFee?: number } = {}) {
    const posted: string[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/address/${FROM_WPKH}/utxo`)) return new Response(JSON.stringify(UTXOS));
      if (url.endsWith('/v1/fees/recommended')) return new Response(JSON.stringify({ hourFee: opts.hourFee ?? 10 }));
      if (url === 'https://blockstream.info/api/tx' && init?.method === 'POST') {
        posted.push(String(init.body));
        return textResponse(bitcoin.Transaction.fromHex(String(init.body)).getId());
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fn);
    return { fn, posted };
  }

  it('uses the passed rate (no fee re-fetch) and wipes the key', async () => {
    const { fn, posted } = chainFetch({ hourFee: 300 });
    const txid = await sendBtc('blob', 'pw', TO_WPKH, 0.0006, FROM_WPKH, { feeRateSatVb: 12 });
    expect(fn.mock.calls.some((c) => String(c[0]).includes('/fees/recommended'))).toBe(false);
    const tx = bitcoin.Transaction.fromHex(posted[0]);
    expect(txid).toBe(tx.getId());
    expect(80_000n - sumOut(tx)).toBe(BigInt(209 * 12));
    expect(tx.outs[0].value).toBe(60_000n);
    expect(keyCopy.every((b) => b === 0)).toBe(true);
  });

  it('rate above the cap is refused before decrypting the key', async () => {
    const { posted } = chainFetch();
    await expect(sendBtc('blob', 'pw', TO_WPKH, 0.0006, FROM_WPKH, { feeRateSatVb: 600 }))
      .rejects.toMatchObject({ code: 'BTC_FEE_RATE_TOO_HIGH' });
    expect(H.decryptBytes).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('without a reviewed rate: fetched as before, still capped', async () => {
    const { posted } = chainFetch({ hourFee: 800 });
    await expect(sendBtc('blob', 'pw', TO_WPKH, 0.0006, FROM_WPKH)).rejects.toMatchObject({ code: 'BTC_FEE_RATE_TOO_HIGH' });
    expect(posted).toHaveLength(0);

    const ok = chainFetch({ hourFee: 7 });
    await sendBtc('blob', 'pw', TO_WPKH, 0.0006, FROM_WPKH);
    expect(80_000n - sumOut(bitcoin.Transaction.fromHex(ok.posted[0]))).toBe(BigInt(209 * 7));
  });

  it('dust amount is refused with a code, without decrypting', async () => {
    chainFetch();
    await expect(sendBtc('blob', 'pw', TO_WPKH, 0.00000546, FROM_WPKH, { feeRateSatVb: 5 }))
      .rejects.toMatchObject({ code: 'BTC_DUST' });
    expect(H.decryptBytes).not.toHaveBeenCalled();
  });

  it('btcToSats is exact decimal math', () => {
    expect(btcToSats('0.00000001')).toBe(1n);
    expect(btcToSats('21000000')).toBe(2_100_000_000_000_000n);
    expect(btcToSats('0.1')).toBe(10_000_000n);
    expect(btcToSats('1.23456789')).toBe(123_456_789n);
  });
});

describe('broadcastBtcTx: one fallback on network error / 5xx, never on a rejection', () => {
  let rawHex = '';
  let txid = '';
  beforeEach(async () => {
    rawHex = await buildSignedTx(PRIV, UTXOS, TO_WPKH, FROM_WPKH, 60_000n, 10);
    txid = bitcoin.Transaction.fromHex(rawHex).getId();
  });

  it('Blockstream OK → txid, mempool.space untouched', async () => {
    const f = vi.fn(async () => textResponse(txid));
    vi.stubGlobal('fetch', f);
    await expect(broadcastBtcTx(rawHex)).resolves.toBe(txid);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('network error → mempool.space', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(textResponse(txid));
    vi.stubGlobal('fetch', f);
    await expect(broadcastBtcTx(rawHex)).resolves.toBe(txid);
    expect(f.mock.calls[1][0]).toBe('https://mempool.space/api/tx');
    expect(f.mock.calls[1][1].body).toBe(rawHex);
  });

  it('5xx → mempool.space', async () => {
    const f = vi.fn().mockResolvedValueOnce(textResponse('upstream', 502)).mockResolvedValueOnce(textResponse(txid));
    vi.stubGlobal('fetch', f);
    await expect(broadcastBtcTx(rawHex)).resolves.toBe(txid);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('4xx rejection is surfaced with the node reason and not retried elsewhere', async () => {
    const reason = 'sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met"}';
    const f = vi.fn().mockResolvedValueOnce(textResponse(reason, 400));
    vi.stubGlobal('fetch', f);
    await expect(broadcastBtcTx(rawHex)).rejects.toMatchObject({ code: 'BTC_BROADCAST_REJECTED', detail: reason });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('first POST lost, fallback says already in mempool → success (same txid)', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(textResponse('sendrawtransaction RPC error: {"code":-27,"message":"txn-already-in-mempool"}', 400));
    vi.stubGlobal('fetch', f);
    await expect(broadcastBtcTx(rawHex)).resolves.toBe(txid);
  });

  it('both unreachable → BTC_BROADCAST_UNAVAILABLE after exactly one retry', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', f);
    await expect(broadcastBtcTx(rawHex)).rejects.toMatchObject({ code: 'BTC_BROADCAST_UNAVAILABLE' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('review (simulate.ts BTC section) uses the signer model and exposes the rate', () => {
  const BAL: Record<SimCoin, number> = { ETH: 0, BTC: 0.0008, SOL: 0, USDT: 0, TRX: 0, TRC20: 0, TON: 0, USDT_TON: 0 };
  const RATES = { eth: 1, btc: 50_000, sol: 1, trx: 1, ton: 1 };

  function stub(from: string, utxos: UTXO[], hourFee: number) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith(`/address/${from}/utxo`)) return new Response(JSON.stringify(utxos));
      if (url.endsWith('/v1/fees/recommended')) return new Response(JSON.stringify({ hourFee }));
      throw new Error(`unexpected ${url}`);
    }));
  }

  it('P2WPKH: review fee equals the fee the signer will pay; rate returned', async () => {
    stub(FROM_WPKH, UTXOS, 10);
    const r = await simulateTransfer({ coin: 'BTC', toAddress: TO_WPKH, amount: 0.0006, balances: BAL, eurRates: RATES, fromBtcAddress: FROM_WPKH });
    expect(r.status).toBe('ok');
    expect(r.btcFeeRateSatVb).toBe(10);
    expect(Math.round(r.feeNative! * 1e8)).toBe(Number(planBtcTx(UTXOS, 60_000n, 10, TO_WPKH, FROM_WPKH).fee));
  });

  it('P2PKH source is sized with 148 vB inputs (was 68)', async () => {
    const legacy = [utxo('cc'.repeat(32), 0, 100_000)];
    stub(FROM_PKH, legacy, 5);
    const { feeNative, feeRateSatVb } = await estimateBtcFee({ amount: 0.0005, fromBtcAddress: FROM_PKH, toAddress: TO_WPKH });
    expect(feeRateSatVb).toBe(5);
    expect(Math.round(feeNative * 1e8)).toBe(223 * 5);
  });

  it('unknown recipient (MAX before typing an address) assumes the largest output', async () => {
    stub(FROM_WPKH, UTXOS, 10);
    const { feeNative } = await estimateBtcFee({ amount: 0.0003, fromBtcAddress: FROM_WPKH });
    expect(Math.round(feeNative * 1e8)).toBe((11 + 68 + 43 + 31) * 10);
  });

  it('balance short of the amount: fee for spending everything, review blocks', async () => {
    stub(FROM_WPKH, UTXOS, 10);
    const r = await simulateTransfer({ coin: 'BTC', toAddress: TO_WPKH, amount: 0.0009, balances: BAL, eurRates: RATES, fromBtcAddress: FROM_WPKH });
    expect(Math.round(r.feeNative! * 1e8)).toBe(209 * 10);
    expect(r.warnings).toContainEqual({ level: 'block', code: 'insufficient_funds' });
  });
});
