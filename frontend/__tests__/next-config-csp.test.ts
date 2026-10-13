import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const CONFIG_PATH = resolve(__dirname, '../next.config.js');

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

/** Fresh load of next.config.js (the CSP is computed at module load from env). */
async function loadHeaders(supabaseUrl: string | undefined): Promise<Rule[]> {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  try {
    delete require.cache[CONFIG_PATH];
    const cfg = require(CONFIG_PATH) as { headers: () => Promise<Rule[]> };
    return await cfg.headers();
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
    delete require.cache[CONFIG_PATH];
  }
}

function pageHeader(rules: Rule[], key: string): string {
  const page = rules.find((r) => r.headers.some((h) => h.key === 'Content-Security-Policy'))!;
  return page.headers.find((h) => h.key === key)!.value;
}

function directive(csp: string, name: string): string[] {
  const d = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name} `));
  return d ? d.split(/\s+/).slice(1) : [];
}

describe('next.config.js security headers', () => {
  afterEach(() => {
    delete require.cache[CONFIG_PATH];
  });

  it('connect-src pins the exact Supabase project origin from NEXT_PUBLIC_SUPABASE_URL', async () => {
    const csp = pageHeader(await loadHeaders('https://abcdefgh.supabase.co/'), 'Content-Security-Policy');
    const connect = directive(csp, 'connect-src');
    expect(connect).toContain('https://abcdefgh.supabase.co');
    expect(connect).not.toContain('https://*.supabase.co');
  });

  it('falls back to the *.supabase.co wildcard only when the env is missing or invalid', async () => {
    for (const env of [undefined, '', 'not a url', 'http://insecure.supabase.co']) {
      const csp = pageHeader(await loadHeaders(env), 'Content-Security-Policy');
      expect(directive(csp, 'connect-src')).toContain('https://*.supabase.co');
    }
  });

  it('connect-src drops server-only / unused hosts and the old ETH RPC, adds the new ETH RPCs', async () => {
    const connect = directive(pageHeader(await loadHeaders('https://x.supabase.co'), 'Content-Security-Policy'), 'connect-src');
    for (const gone of [
      'https://api.telegram.org',
      'https://gonkabroker.com',
      'https://*.gonkabroker.com',
      'https://cloudflare-eth.com',
    ]) {
      expect(connect).not.toContain(gone);
    }
    for (const host of [
      "'self'",
      'https://ethereum-rpc.publicnode.com',
      'https://1rpc.io',
      'https://eth.drpc.org',
      'https://api.mainnet-beta.solana.com',
      'https://blockstream.info',
      'https://mempool.space',
      'https://api.etherscan.io',
      'https://api.coingecko.com',
      'https://api.trongrid.io',
      'https://toncenter.com',
      'https://tonapi.io',
    ]) {
      expect(connect).toContain(host);
    }
    expect(connect.some((h) => h === 'https:' || h === '*')).toBe(false);
  });

  it('img-src is limited to self, data: and Telegram avatar hosts (no blanket https:)', async () => {
    const img = directive(pageHeader(await loadHeaders('https://x.supabase.co'), 'Content-Security-Policy'), 'img-src');
    expect(img).toEqual(expect.arrayContaining(["'self'", 'data:', 'https://t.me', 'https://*.telegram.org']));
    expect(img).not.toContain('https:');
    expect(img).not.toContain('*');
  });

  it('adds object-src none, base-uri self, form-action self and keeps the existing directives', async () => {
    const csp = pageHeader(await loadHeaders('https://x.supabase.co'), 'Content-Security-Policy');
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'script-src')).toEqual(["'self'", 'https://telegram.org']);
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(csp, 'frame-ancestors')).toContain('https://web.telegram.org');
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('sends a Permissions-Policy that disables unused powerful features', async () => {
    const pp = pageHeader(await loadHeaders('https://x.supabase.co'), 'Permissions-Policy');
    for (const f of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) {
      expect(pp).toContain(f);
    }
  });
});
