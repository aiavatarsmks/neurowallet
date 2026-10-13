// @vitest-environment node
/**
 * ethAddressFromMnemonic: the cheap derivation the ?recover=1 import flow uses
 * to tell "same wallet" from "different wallet" before the password step.
 * Node environment: ethers' mnemonic code breaks under the jsdom realm.
 */
import { describe, it, expect } from 'vitest';
import { ethAddressFromMnemonic } from '@/lib/crypto/wallet';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ETH_VECTOR = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'; // BIP44 m/44'/60'/0'/0/0

describe('ethAddressFromMnemonic', () => {
  it('derives the BIP44 ETH address (same as importWalletFromMnemonic)', () => {
    expect(ethAddressFromMnemonic(PHRASE)).toBe(ETH_VECTOR);
  });

  it('normalises case and whitespace like the import does', () => {
    expect(ethAddressFromMnemonic(`  ${PHRASE.toUpperCase().replace(/ /g, '   ')} `)).toBe(ETH_VECTOR);
  });

  it('rejects an invalid phrase with the import error', () => {
    expect(() => ethAddressFromMnemonic('abandon '.repeat(12).trim())).toThrow(/мнемоническая/);
  });
});
