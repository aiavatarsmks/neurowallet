import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidTonAddress } from '@/lib/crypto/ton-tx';

// ENS: stub only ethers.JsonRpcProvider; keep isAddress/getAddress real.
const ENS_FIX: Record<string, string | null> = {
  'vitalik.eth': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'notfound.eth': null,
  'bad.eth': '0xnot-an-address',
};
vi.mock('ethers', async (orig) => {
  const actual = (await orig()) as typeof import('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn().mockImplementation(() => ({
        resolveName: (n: string) => Promise.resolve(ENS_FIX[n] ?? null),
      })),
    },
  };
});

import {
  looksLikeEnsName, looksLikeTonDnsName, isResolvableName,
  resolveEns, resolveTonDns, resolveName,
} from '@/lib/name-resolvers';

// Real tonapi shape captured live from foundation.ton.
const TON_OK = { wallet: { address: '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8' } };
const TON_ERR = { error: 'not resolved: cant unmarshal null' };

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }));
}

describe('name detection', () => {
  it('detects ENS names', () => {
    expect(looksLikeEnsName('vitalik.eth')).toBe(true);
    expect(looksLikeEnsName('a.b.eth')).toBe(true);
    expect(looksLikeEnsName('vitalik.ton')).toBe(false);
    expect(looksLikeEnsName('0xabc')).toBe(false);
    expect(looksLikeEnsName('vitalik')).toBe(false);
  });
  it('detects TON DNS names', () => {
    expect(looksLikeTonDnsName('foundation.ton')).toBe(true);
    expect(looksLikeTonDnsName('a.b.ton')).toBe(true);
    expect(looksLikeTonDnsName('foundation.eth')).toBe(false);
  });
  it('isResolvableName covers both', () => {
    expect(isResolvableName('x.eth')).toBe(true);
    expect(isResolvableName('x.ton')).toBe(true);
    expect(isResolvableName('EQabc')).toBe(false);
  });
});

describe('resolveEns (fail-closed)', () => {
  it('resolves a known name to a checksummed address', async () => {
    expect(await resolveEns('vitalik.eth')).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  });
  it('returns null for a non-.eth input without a network call', async () => {
    expect(await resolveEns('vitalik.ton')).toBeNull();
  });
  it('returns null when the name does not resolve', async () => {
    expect(await resolveEns('notfound.eth')).toBeNull();
  });
  it('returns null when the resolver yields a non-address (fail-closed)', async () => {
    expect(await resolveEns('bad.eth')).toBeNull();
  });
});

describe('resolveTonDns (fail-closed)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('resolves a .ton name to a valid friendly TON address', async () => {
    mockFetch(TON_OK);
    const addr = await resolveTonDns('foundation.ton');
    expect(addr).not.toBeNull();
    expect(isValidTonAddress(addr as string)).toBe(true);
    expect((addr as string).startsWith('EQ')).toBe(true); // bounceable friendly
    vi.unstubAllGlobals();
  });
  it('returns null on a not-resolved error (fail-closed)', async () => {
    mockFetch(TON_ERR);
    expect(await resolveTonDns('nope.ton')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('returns null on a non-ok response', async () => {
    mockFetch({}, false);
    expect(await resolveTonDns('down.ton')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('returns null for a non-.ton input without a network call', async () => {
    expect(await resolveTonDns('vitalik.eth')).toBeNull();
  });
});

describe('resolveName routing', () => {
  it('routes eth→ENS and ton→TON DNS; mismatched suffix → null', async () => {
    mockFetch(TON_OK);
    expect(await resolveName('foundation.ton', 'ton')).not.toBeNull();
    expect(await resolveName('foundation.ton', 'eth')).toBeNull(); // .ton on eth chain → null
    vi.unstubAllGlobals();
    expect(await resolveName('vitalik.eth', 'eth')).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(await resolveName('vitalik.eth', 'ton')).toBeNull(); // .eth on ton chain → null
  });
});
