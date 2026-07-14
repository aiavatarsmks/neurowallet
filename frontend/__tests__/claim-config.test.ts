import { describe, it, expect } from 'vitest';
import { buildClaimUrl, parseClaimFromLocation, isClaimAsset, CLAIM_DEFAULT_ASSET } from '@/lib/claim-config';

describe('claim-config', () => {
  it('builds the canonical URL with the secret in the FRAGMENT (never in query)', () => {
    const url = buildClaimUrl('https://neurowallet.tech', 'abc-123', 'sekret');
    expect(url).toBe('https://neurowallet.tech/claim?ref=abc-123#s=sekret');
    // ref goes to the server (query); secret stays client-side (fragment).
    expect(new URL(url).search).toBe('?ref=abc-123');
    expect(new URL(url).hash).toBe('#s=sekret');
  });
  it('trims a trailing slash on appUrl', () => {
    expect(buildClaimUrl('https://x.tech/', 'r', 's')).toBe('https://x.tech/claim?ref=r#s=s');
  });
  it('round-trips ref (query) + secret (fragment)', () => {
    expect(parseClaimFromLocation({ search: '?ref=r1', hash: '#s=secretz' })).toEqual({ ref: 'r1', secret: 'secretz' });
  });
  it('returns null without a ref', () => {
    expect(parseClaimFromLocation({ search: '', hash: '#s=x' })).toBeNull();
  });
  it('tolerates a missing secret (empty)', () => {
    expect(parseClaimFromLocation({ search: '?ref=r', hash: '' })).toEqual({ ref: 'r', secret: '' });
  });
  it('validates claim assets (TON-first)', () => {
    expect(isClaimAsset('USDT_TON')).toBe(true);
    expect(isClaimAsset('TON')).toBe(true);
    expect(isClaimAsset('BTC')).toBe(false);
    expect(CLAIM_DEFAULT_ASSET).toBe('USDT_TON');
  });
});
