import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '@/pages/api/csp-report';
import { checkRateLimit } from '@/lib/server/api-security';
import { mockReq, mockRes } from './helpers';

vi.mock('@/lib/server/api-security', () => ({
  checkRateLimit: vi.fn(),
}));

const mockedLimit = vi.mocked(checkRateLimit);

function report(blockedUri: string) {
  return mockReq({
    method: 'POST',
    body: JSON.stringify({
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': blockedUri,
        'document-uri': 'https://neurowallet-frontend.vercel.app/wallet',
      },
    }),
  });
}

describe('POST /api/csp-report', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedLimit.mockReturnValue(true);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns 429 when the per-IP rate limit is exceeded', async () => {
    mockedLimit.mockReturnValue(false);
    const res = mockRes();
    await handler(report('https://evil.example'), res);
    expect(res.statusCode).toBe(429);
  });

  it('accepts a report with 204 and logs it once (dedup)', async () => {
    const uri = `https://evil.example/${Date.now()}`;
    const res1 = mockRes();
    await handler(report(uri), res1);
    expect(res1.statusCode).toBe(204);

    const res2 = mockRes();
    await handler(report(uri), res2);
    expect(res2.statusCode).toBe(204);

    // Same (directive, blocked-uri) pair → logged exactly once.
    const logged = warnSpy.mock.calls.filter((c) => String(c[1]).includes(uri));
    expect(logged.length).toBe(1);
  });

  it('never errors on malformed bodies', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: 'not json {{{' }), res);
    expect(res.statusCode).toBe(204);
  });
});

describe('CSP composition (next.config.js)', () => {
  it('script-src has no unsafe-inline and reporting is enabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nextConfig = require('../../next.config.js');
    const headerSets = await nextConfig.headers();
    const cspHeader = headerSets
      .flatMap((h: { headers: Array<{ key: string; value: string }> }) => h.headers)
      .find((h: { key: string }) => h.key === 'Content-Security-Policy');

    expect(cspHeader).toBeDefined();
    const scriptSrc = cspHeader.value
      .split(';')
      .map((d: string) => d.trim())
      .find((d: string) => d.startsWith('script-src'));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(cspHeader.value).toContain('report-uri /api/csp-report');
  });
});
