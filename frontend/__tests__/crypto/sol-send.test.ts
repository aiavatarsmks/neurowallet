// @vitest-environment node
/**
 * sendSol broadcast outcomes: the signature is known before broadcast, so a
 * lost answer is looked up by signature instead of ending as a retryable
 * error. Network is mocked at fetch level (the real solRpc failover runs);
 * the key is a throwaway test scalar, never funded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

const H = vi.hoisted(() => ({ decryptBytes: vi.fn() }));
vi.mock('@/lib/crypto/aes', () => ({ decryptBytes: H.decryptBytes }));

import { sendSol } from '@/lib/crypto/transactions';
import { SolRpcError, SOL_SERVER_RPC_URLS } from '@/lib/crypto/sol-rpc';
import { BroadcastOutcomeUnknownError, isBroadcastOutcomeUnknown } from '@/lib/crypto/broadcast-error';

const KEY = Uint8Array.from(createHash('sha256').update('neurowallet-sol-send-test-key').digest());
const FROM = ed25519.getPublicKey(KEY);
const TO = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const BLOCKHASH = bs58.encode(new Uint8Array(32).fill(7));
/** What tx-status.ts getTxStatus('SOL', hash) accepts. */
const SOL_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

type Rpc = { method: string; params: unknown[] };
type Reply = (rpc: Rpc) => Response | Promise<Response>;
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
const rpcErr = (code: number, message: string, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }), { status });
const offline: Reply = () => Promise.reject(new TypeError('fetch failed'));

let keyCopy: Uint8Array;
beforeEach(() => {
  H.decryptBytes.mockReset().mockImplementation(async () => {
    keyCopy = new Uint8Array(KEY);
    return keyCopy;
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Both server endpoints answer with the same handlers, keyed by JSON-RPC method. */
function solNode(over: Partial<Record<string, Reply>> = {}) {
  const calls: Rpc[] = [];
  const handlers: Record<string, Reply> = {
    getLatestBlockhash: () => ok({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100 } }),
    sendTransaction: () => ok('sig-echo-ignored'),
    getSignatureStatuses: () => ok({ context: { slot: 1 }, value: [null] }),
    ...over,
  };
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    expect(SOL_SERVER_RPC_URLS as readonly string[]).toContain(url);
    const rpc = JSON.parse(String(init?.body)) as Rpc;
    calls.push(rpc);
    const h = handlers[rpc.method];
    if (!h) throw new Error(`unexpected ${rpc.method}`);
    return h(rpc);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, methods: () => calls.map((c) => c.method) };
}

/** The signature the wallet put in the sent bytes (first sendTransaction call). */
function sentSignature(calls: Rpc[]): string {
  const send = calls.find((c) => c.method === 'sendTransaction')!;
  const tx = Buffer.from(String(send.params[0]), 'base64');
  return bs58.encode(tx.subarray(1, 65));
}

describe('sendSol', () => {
  it('accepted: returns the base58 signature of the signed message, key wiped', async () => {
    const node = solNode();
    const sig = await sendSol('blob', 'pw', TO, 0.25);
    expect(sig).toMatch(SOL_SIG_RE);
    expect(sig).toBe(sentSignature(node.calls));
    const tx = Buffer.from(String(node.calls.find((c) => c.method === 'sendTransaction')!.params[0]), 'base64');
    expect(ed25519.verify(tx.subarray(1, 65), tx.subarray(65), FROM)).toBe(true);
    expect(node.methods()).not.toContain('getSignatureStatuses');
    expect(keyCopy.every((b) => b === 0)).toBe(true);
  });

  it('"This transaction has already been processed" → the same bytes landed → success, no lookup', async () => {
    const node = solNode({
      sendTransaction: () => rpcErr(-32002, 'Transaction simulation failed: This transaction has already been processed'),
    });
    const sig = await sendSol('blob', 'pw', TO, 0.25);
    expect(sig).toBe(sentSignature(node.calls));
    expect(node.methods()).not.toContain('getSignatureStatuses');
  });

  it('AlreadyProcessed in the error text counts too', async () => {
    solNode({ sendTransaction: () => rpcErr(-32002, 'Transaction simulation failed: AlreadyProcessed') });
    await expect(sendSol('blob', 'pw', TO, 0.25)).resolves.toMatch(SOL_SIG_RE);
  });

  it('a real node rejection (preflight: insufficient funds for rent) stays an ordinary error; no lookup', async () => {
    const node = solNode({
      sendTransaction: () => rpcErr(-32002, 'Transaction simulation failed: Transaction results in an account (1) with insufficient funds for rent'),
    });
    const err = await sendSol('blob', 'pw', TO, 0.25).catch((e) => e);
    expect(err).toBeInstanceOf(SolRpcError);
    expect(isBroadcastOutcomeUnknown(err)).toBe(false);
    expect(node.methods()).not.toContain('getSignatureStatuses');
    expect(keyCopy.every((b) => b === 0)).toBe(true);
  });

  it('no endpoint answered sendTransaction, but the signature is known to the cluster → success', async () => {
    const node = solNode({
      sendTransaction: offline,
      getSignatureStatuses: (rpc) => {
        expect(rpc.params[1]).toEqual({ searchTransactionHistory: true });
        return ok({ context: { slot: 2 }, value: [{ slot: 2, confirmations: 0, err: null, confirmationStatus: 'processed' }] });
      },
    });
    const sig = await sendSol('blob', 'pw', TO, 0.25);
    expect(sig).toBe(sentSignature(node.calls));
    const lookup = node.calls.find((c) => c.method === 'getSignatureStatuses')!;
    expect(lookup.params[0]).toEqual([sig]);
  });

  it('no endpoint answered and the signature is unknown → BroadcastOutcomeUnknownError(signature)', async () => {
    const node = solNode({ sendTransaction: offline });
    const err = await sendSol('blob', 'pw', TO, 0.25).catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastOutcomeUnknownError);
    expect(err.hash).toBe(sentSignature(node.calls));
    expect(err.hash).toMatch(SOL_SIG_RE);
    expect(keyCopy.every((b) => b === 0)).toBe(true);
  });

  it('the lookup fails too → still unknown, never an ordinary error', async () => {
    solNode({ sendTransaction: offline, getSignatureStatuses: offline });
    await expect(sendSol('blob', 'pw', TO, 0.25)).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
  });

  it('5xx, rate limit and -32603 internal error on every endpoint count as "no answer"', async () => {
    let n = 0;
    const replies = [
      () => new Response('Bad Gateway', { status: 502 }),
      () => rpcErr(429, 'Too many requests', 429),
      () => rpcErr(-32603, 'Internal error'),
    ];
    for (const reply of replies) {
      solNode({ sendTransaction: () => { n += 1; return reply(); } });
      await expect(sendSol('blob', 'pw', TO, 0.25)).rejects.toBeInstanceOf(BroadcastOutcomeUnknownError);
    }
    expect(n).toBe(replies.length * SOL_SERVER_RPC_URLS.length); // the same bytes went to each endpoint once
  });

  it('a failure before broadcast (blockhash unavailable) is an ordinary error', async () => {
    solNode({ getLatestBlockhash: offline });
    const err = await sendSol('blob', 'pw', TO, 0.25).catch((e) => e);
    expect(isBroadcastOutcomeUnknown(err)).toBe(false);
    expect(err.name).toBe('SolRpcUnavailableError');
  });
});
