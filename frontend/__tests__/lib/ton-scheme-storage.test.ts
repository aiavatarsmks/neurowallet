import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredTonScheme } from '@/lib/ton-mnemonic-config';
import { saveWalletToStorage, clearWalletFromStorage, type CryptoWallet } from '@/lib/crypto/wallet';

const WALLET = {
  eth: '0xabc', sol: 's', btc: 'b', tron: 't', ton: 'UQx', tonScheme: 'ton-mnemonic-v4r2',
  mnemonic: 'never stored', keystore: '{}', solEnc: 'e1', btcEnc: 'e2', tronEnc: 'e3', tonEnc: 'e4',
} as CryptoWallet;

describe('wallet_ton_scheme storage', () => {
  beforeEach(() => localStorage.clear());

  it('no wallet → null; wallet without scheme key (pre-existing) → legacy', () => {
    expect(readStoredTonScheme()).toBeNull();
    localStorage.setItem('wallet_ton_address', 'EQx');
    expect(readStoredTonScheme()).toBe('slip10-607-0-0');
  });

  it('saveWalletToStorage persists the scheme, never the phrase; clear removes it', () => {
    saveWalletToStorage(WALLET);
    expect(readStoredTonScheme()).toBe('ton-mnemonic-v4r2');
    const values = Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i)!));
    expect(values.length).toBeGreaterThan(5);
    expect(values).not.toContain('never stored');
    clearWalletFromStorage();
    expect(localStorage.getItem('wallet_ton_scheme')).toBeNull();
  });
});
