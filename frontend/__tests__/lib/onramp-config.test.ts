import { describe, it, expect } from 'vitest';
import {
  onrampAvailableForRegion, isOnrampAsset, isTerminalRampStatus,
} from '@/lib/onramp-config';

describe('onramp — region gate (honest refusal before KYC, deny by default)', () => {
  it('allows an EU launch region', () => {
    expect(onrampAvailableForRegion('DE')).toEqual({ available: true, reason: 'ok' });
    expect(onrampAvailableForRegion('fr')).toEqual({ available: true, reason: 'ok' }); // case-insensitive
  });
  it('refuses an unsupported region', () => {
    expect(onrampAvailableForRegion('US')).toEqual({ available: false, reason: 'unsupported_region' });
  });
  it('refuses unknown/garbage region input (before any KYC)', () => {
    expect(onrampAvailableForRegion('')).toEqual({ available: false, reason: 'unknown_region' });
    expect(onrampAvailableForRegion('DEU')).toEqual({ available: false, reason: 'unknown_region' });
    expect(onrampAvailableForRegion(undefined)).toEqual({ available: false, reason: 'unknown_region' });
  });
});

describe('onramp — TON-first asset allowlist', () => {
  it('offers TON + USDT_TON first', () => {
    expect(isOnrampAsset('TON')).toBe(true);
    expect(isOnrampAsset('USDT_TON')).toBe(true);
  });
  it('other assets not in v1', () => {
    expect(isOnrampAsset('ETH')).toBe(false);
    expect(isOnrampAsset('BTC')).toBe(false);
  });
});

describe('onramp — order status', () => {
  it('marks terminal states', () => {
    expect(isTerminalRampStatus('completed')).toBe(true);
    expect(isTerminalRampStatus('failed')).toBe(true);
    expect(isTerminalRampStatus('expired')).toBe(true);
    expect(isTerminalRampStatus('created')).toBe(false);
    expect(isTerminalRampStatus('pending')).toBe(false);
  });
});
