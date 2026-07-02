import { describe, it, expect } from 'vitest';
import { clearLegacyXorKeys } from '@/lib/crypto/wallet';

describe('legacy XOR key cleanup (task 0.5)', () => {
  it('removes stale wallet_*_xor keys and touches nothing else', () => {
    localStorage.setItem('wallet_sol_xor', 'stale');
    localStorage.setItem('wallet_btc_xor', 'stale');
    localStorage.setItem('wallet_tron_xor', 'stale');
    localStorage.setItem('wallet_ton_xor', 'stale');
    localStorage.setItem('wallet_eth_address', '0xabc');

    clearLegacyXorKeys();

    for (const k of ['wallet_sol_xor', 'wallet_btc_xor', 'wallet_tron_xor', 'wallet_ton_xor']) {
      expect(localStorage.getItem(k)).toBeNull();
    }
    expect(localStorage.getItem('wallet_eth_address')).toBe('0xabc');
    localStorage.removeItem('wallet_eth_address');
  });
});
