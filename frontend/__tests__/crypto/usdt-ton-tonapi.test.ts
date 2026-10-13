import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchUsdtTonBalanceTonapi } from '@/lib/crypto/ton-tx';

const ADDR = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N';
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
afterEach(() => vi.unstubAllGlobals());

describe('USDT-TON balance via tonapi (one request)', () => {
  it('reads balance with 6 decimals, asks by raw address', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { balance: '2045010', jetton: { decimals: 6 } }));
    vi.stubGlobal('fetch', f);
    await expect(fetchUsdtTonBalanceTonapi(ADDR)).resolves.toBeCloseTo(2.04501, 6);
    expect(String(f.mock.calls[0][0])).toContain('/accounts/0%3A');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('404 "has no jetton wallet" is a real 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404, { error: 'account 0:ab has no jetton wallet 0:cd' })));
    await expect(fetchUsdtTonBalanceTonapi(ADDR)).resolves.toBe(0);
  });
  it('429, other 404s and malformed bodies reject (never a fake 0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(429, { error: 'rate limit' })));
    await expect(fetchUsdtTonBalanceTonapi(ADDR)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404, { error: 'not found' })));
    await expect(fetchUsdtTonBalanceTonapi(ADDR)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { balance: 12 })));
    await expect(fetchUsdtTonBalanceTonapi(ADDR)).rejects.toThrow();
  });
});
