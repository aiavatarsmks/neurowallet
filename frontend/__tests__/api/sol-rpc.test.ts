// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

const auth = vi.hoisted(() => ({ ok: true, limited: false }));
vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(async () => { if (!auth.ok) throw new Error('UNAUTHORIZED'); return { user: { id: 'u1' }, token: 't' }; }),
  checkRateLimit: vi.fn(async () => !auth.limited),
}));
const H = vi.hoisted(() => ({ decryptBytes: vi.fn() }));
vi.mock('@/lib/crypto/aes', () => ({ decryptBytes: H.decryptBytes }));

import handler from '@/pages/api/sol-rpc';
import { sendSol } from '@/lib/crypto/transactions';

function mockRes() {
  const r = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(c: number) { r.statusCode = c; return res; },
    json(b: unknown) { r.body = b; return res; },
    setHeader(k: string, v: string) { r.headers[k] = v; return res; },
  };
  return { res: res as unknown as NextApiResponse, r };
}
const req = (body: unknown, method = 'POST') => ({ method, body, headers: {} } as unknown as NextApiRequest);
const ok = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) } as Response);

// ─── A SOL transfer built by the wallet's own send path (throwaway key) ──────

const KEY = Uint8Array.from(createHash('sha256').update('neurowallet-sol-proxy-test-key').digest());
const TO = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

/** Run the real sendSol (lib/crypto/transactions.ts) and capture the params it sends. */
async function walletSendParams(): Promise<unknown[]> {
  H.decryptBytes.mockImplementation(async () => new Uint8Array(KEY));
  let captured: unknown[] | null = null;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const rpc = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    if (rpc.method === 'getLatestBlockhash') return ok({ value: { blockhash: bs58.encode(new Uint8Array(32).fill(9)), lastValidBlockHeight: 1 } });
    if (rpc.method === 'sendTransaction') { captured = rpc.params; return ok('sig'); }
    throw new Error(`unexpected ${rpc.method}`);
  }));
  await sendSol('blob', 'pw', TO, 0.125);
  vi.unstubAllGlobals();
  if (!captured) throw new Error('sendSol did not broadcast');
  return captured;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const unb64 = (s: unknown) => new Uint8Array(Buffer.from(String(s), 'base64'));

/** Re-sign an edited message with the same key: only the shape differs, never the signature. */
function signed(msg: Uint8Array, sigCount = 1): string {
  const sig = ed25519.sign(msg, KEY);
  const parts = [new Uint8Array([sigCount]), ...Array.from({ length: sigCount }, () => sig), msg];
  return b64(Buffer.concat(parts));
}

beforeEach(() => { auth.ok = true; auth.limited = false; delete process.env.SOLANA_RPC_URL; });
afterEach(() => vi.unstubAllGlobals());

describe('/api/sol-rpc', () => {
  it('401 without a session, 429 over the limit, 405 on GET', async () => {
    auth.ok = false;
    let m = mockRes(); await handler(req({ method: 'getBalance', params: ['a'] }), m.res); expect(m.r.statusCode).toBe(401);
    auth.ok = true; auth.limited = true;
    m = mockRes(); await handler(req({ method: 'getBalance', params: ['a'] }), m.res); expect(m.r.statusCode).toBe(429);
    m = mockRes(); await handler(req({}, 'GET'), m.res); expect(m.r.statusCode).toBe(405);
  });

  it('rejects methods outside the wallet allowlist and oversized params', async () => {
    let m = mockRes(); await handler(req({ method: 'requestAirdrop', params: [] }), m.res); expect(m.r.statusCode).toBe(400);
    m = mockRes(); await handler(req({ method: 'getBalance', params: 'x' }), m.res); expect(m.r.statusCode).toBe(400);
    m = mockRes(); await handler(req({ method: 'getBalance', params: ['x'.repeat(9000)] }), m.res); expect(m.r.statusCode).toBe(400);
  });

  it('server goes to the official RPC (no Origin from the server) and returns the result', async () => {
    const f = vi.fn().mockResolvedValue(ok({ value: 42 }));
    vi.stubGlobal('fetch', f);
    const m = mockRes(); await handler(req({ method: 'getBalance', params: ['a'] }), m.res);
    expect(m.r.statusCode).toBe(200);
    expect(m.r.body).toMatchObject({ result: { value: 42 } });
    expect(f.mock.calls[0][0]).toBe('https://api.mainnet-beta.solana.com');
  });

  it('SOLANA_RPC_URL (keyed) goes first when set', async () => {
    process.env.SOLANA_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=secret';
    const f = vi.fn().mockResolvedValue(ok({ value: 1 }));
    vi.stubGlobal('fetch', f);
    const m = mockRes(); await handler(req({ method: 'getBalance', params: ['a'] }), m.res);
    expect(f.mock.calls[0][0]).toBe('https://mainnet.helius-rpc.com/?api-key=secret');
    expect(JSON.stringify(m.r.body)).not.toContain('secret');
  });

  it('passes a real node error through; all upstreams down → 502', async () => {
    const params = await walletSendParams();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'insufficient funds for rent' } }) }));
    let m = mockRes(); await handler(req({ method: 'sendTransaction', params }), m.res);
    expect(m.r.statusCode).toBe(200);
    expect(m.r.body).toMatchObject({ error: { code: -32002, message: 'insufficient funds for rent' } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    m = mockRes(); await handler(req({ method: 'getBalance', params: ['a'] }), m.res);
    expect(m.r.statusCode).toBe(502);
  });
});

describe('/api/sol-rpc sendTransaction: only the wallet\'s own SOL transfer is relayed', () => {
  async function relay(params: unknown[]) {
    const upstream = vi.fn().mockResolvedValue(ok('5ig'));
    vi.stubGlobal('fetch', upstream);
    const m = mockRes();
    await handler(req({ method: 'sendTransaction', params }), m.res);
    return { status: m.r.statusCode, body: m.r.body, upstream };
  }

  it('the transfer built by sendSol goes through unchanged', async () => {
    const params = await walletSendParams();
    const { status, upstream } = await relay(params);
    expect(status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(upstream.mock.calls[0][1].body)).params).toEqual(params);
  });

  it('rejects every other shape with 400 and never reaches the keyed provider', async () => {
    const [raw, cfg] = await walletSendParams();
    const tx = unb64(raw);
    const msg = tx.slice(65);
    const edit = (f: (m: Uint8Array) => Uint8Array) => signed(f(msg.slice()));
    const set = (i: number, v: number) => (m: Uint8Array) => { m[i] = v; return m; };
    const IX = 132; // instruction section offset in the 150-byte message

    const variants: Record<string, unknown[]> = {
      'two signatures': [signed(msg, 2), cfg],
      'versioned (v0) message': [signed(Buffer.concat([new Uint8Array([0x80]), msg, new Uint8Array([0])])), cfg],
      'header: 2 signers': [edit(set(0, 2)), cfg],
      'header: 0 read-only unsigned': [edit(set(2, 0)), cfg],
      'four account keys': [signed(Buffer.concat([msg.slice(0, 3), new Uint8Array([4]), msg.slice(4, 100), new Uint8Array(32).fill(5), msg.slice(100)])), cfg],
      'third key is not the System Program (e.g. a token program)': [edit((m) => { m.set(bs58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), 68); return m; }), cfg],
      'two instructions': [edit(set(IX, 2)), cfg],
      'program index 1': [edit(set(IX + 1, 1)), cfg],
      'accounts swapped (from = key 1)': [edit((m) => { m[IX + 3] = 1; m[IX + 4] = 0; return m; }), cfg],
      'SystemInstruction::CreateAccount (0) instead of Transfer (2)': [edit(set(IX + 6, 0)), cfg],
      'SystemInstruction::Assign (1)': [edit(set(IX + 6, 1)), cfg],
      'zero lamports': [edit((m) => { m.fill(0, IX + 10, IX + 18); return m; }), cfg],
      'trailing byte after the message': [signed(Buffer.concat([msg, new Uint8Array([0])])), cfg],
      'data length 13': [edit(set(IX + 5, 13)), cfg],
      'signature does not match': [b64(Buffer.concat([tx.slice(0, 1), tx.slice(1, 65).map((b, i) => (i === 0 ? b ^ 1 : b)), msg])), cfg],
      'signed by another key': [b64(Buffer.concat([new Uint8Array([1]), ed25519.sign(msg, new Uint8Array(32).fill(3)), msg])), cfg],
      'no config (base58 default encoding)': [raw],
      'encoding base58': [raw, { encoding: 'base58' }],
      'extra config key (skipPreflight)': [raw, { ...(cfg as object), skipPreflight: true }],
      'not base64': [String(raw).slice(0, -2) + '!!', cfg],
      'non-canonical base64 (whitespace)': [' ' + String(raw), cfg],
      'not a string': [Array.from(tx), cfg],
      'a garbage string': ['tx', cfg],
    };
    for (const [name, params] of Object.entries(variants)) {
      const { status, body, upstream } = await relay(params);
      expect({ name, status }).toEqual({ name, status: 400 });
      expect(body).toMatchObject({ error: { code: -32602 } });
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it('reads are unaffected by the transfer check', async () => {
    const upstream = vi.fn().mockResolvedValue(ok({ value: [null] }));
    vi.stubGlobal('fetch', upstream);
    const m = mockRes();
    await handler(req({ method: 'getSignatureStatuses', params: [['x'], { searchTransactionHistory: true }] }), m.res);
    expect(m.r.statusCode).toBe(200);
  });
});
