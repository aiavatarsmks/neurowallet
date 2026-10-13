// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const auth = vi.hoisted(() => ({ ok: true, limited: false }));
vi.mock('@/lib/server/api-security', () => ({
  requireSupabaseUser: vi.fn(async () => { if (!auth.ok) throw new Error('UNAUTHORIZED'); return { user: { id: 'u1' }, token: 't' }; }),
  checkRateLimit: vi.fn(async () => !auth.limited),
}));

import handler from '@/pages/api/sol-rpc';

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'insufficient funds for rent' } }) }));
    let m = mockRes(); await handler(req({ method: 'sendTransaction', params: ['tx'] }), m.res);
    expect(m.r.statusCode).toBe(200);
    expect(m.r.body).toMatchObject({ error: { code: -32002, message: 'insufficient funds for rent' } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    m = mockRes(); await handler(req({ method: 'getBalance', params: ['a'] }), m.res);
    expect(m.r.statusCode).toBe(502);
  });
});
