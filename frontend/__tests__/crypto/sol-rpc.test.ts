import { describe, it, expect, vi, afterEach } from 'vitest';
import { solRpc, SolRpcError, SolRpcUnavailableError, SOL_BROWSER_RPC_URLS, SOL_PROXY_PATH } from '@/lib/crypto/sol-rpc';

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const OK = (result: unknown) => res(200, { jsonrpc: '2.0', id: 1, result });

afterEach(() => vi.unstubAllGlobals());

describe('solRpc (browser)', () => {
  it('uses the browser-allowed RPC first, never the official one (403 on any Origin)', async () => {
    const f = vi.fn().mockResolvedValueOnce(OK({ value: 5 }));
    vi.stubGlobal('fetch', f);
    await expect(solRpc('getBalance', ['addr'], { getProxyToken: async () => 't' })).resolves.toEqual({ value: 5 });
    expect(f.mock.calls[0][0]).toBe(SOL_BROWSER_RPC_URLS[0]);
    expect(String(f.mock.calls[0][0])).not.toContain('mainnet-beta');
  });

  it('transport failure (403 / 429 / network) → same-origin proxy with the session token', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(403, { jsonrpc: '2.0', id: 1, error: { code: 403, message: 'Access forbidden' } }))
      .mockResolvedValueOnce(OK({ value: 7 }));
    vi.stubGlobal('fetch', f);
    await expect(solRpc('getBalance', ['addr'], { getProxyToken: async () => 'tok' })).resolves.toEqual({ value: 7 });
    expect(f.mock.calls[1][0]).toBe(SOL_PROXY_PATH);
    expect((f.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(JSON.parse(String((f.mock.calls[1][1] as RequestInit).body))).toEqual({ method: 'getBalance', params: ['addr'] });
  });

  it('a rate-limit code inside a 200 JSON-RPC body is a transport failure too', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, { jsonrpc: '2.0', id: 1, error: { code: -32029, message: 'Too Many Requests' } }))
      .mockResolvedValueOnce(OK({ value: 1 }));
    vi.stubGlobal('fetch', f);
    await expect(solRpc('getBalance', ['addr'], { getProxyToken: async () => 't' })).resolves.toEqual({ value: 1 });
  });

  it('-32603 "Internal error" is the RPC twin of a 5xx: fail over, never a definitive answer', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }))
      .mockResolvedValueOnce(OK('sig'));
    vi.stubGlobal('fetch', f);
    await expect(solRpc('sendTransaction', ['tx'], { getProxyToken: async () => 't' })).resolves.toBe('sig');
    expect(f.mock.calls[1][0]).toBe(SOL_PROXY_PATH);
  });

  it('a real node error is surfaced at once, no failover (same signed tx → same answer)', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Transaction simulation failed: insufficient funds for rent' } }));
    vi.stubGlobal('fetch', f);
    const p = solRpc('sendTransaction', ['tx'], { getProxyToken: async () => 't' });
    await expect(p).rejects.toBeInstanceOf(SolRpcError);
    await expect(p).rejects.toThrow(/insufficient funds for rent/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('no session and the public RPC down → SolRpcUnavailableError (caller shows "unavailable", not 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(solRpc('getBalance', ['addr'], { getProxyToken: async () => null })).rejects.toBeInstanceOf(SolRpcUnavailableError);
  });

  it('explicit url list (server) does not touch the proxy', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('down'))
      .mockResolvedValueOnce(OK({ value: 3 }));
    vi.stubGlobal('fetch', f);
    await expect(solRpc('getBalance', ['a'], { urls: ['https://a.example', 'https://b.example'] })).resolves.toEqual({ value: 3 });
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://a.example', 'https://b.example']);
  });
});
