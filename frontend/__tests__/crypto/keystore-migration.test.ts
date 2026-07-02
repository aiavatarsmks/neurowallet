/**
 * Migration tests for legacy scrypt N=8192 keystores (task 0.4).
 * Uses throwaway test wallets only. scrypt at N=131072 is intentionally
 * slow (~seconds per operation), hence the long timeouts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ethers, encryptKeystoreJson } from 'ethers';
import {
  KEYSTORE_SCRYPT_N,
  keystoreScryptN,
  upgradeKeystore,
  upgradeStoredKeystoreIfWeak,
} from '@/lib/crypto/keystore-migration';

const PASSWORD = 'test-password-123';
const SLOW = 180_000;

// Well-known throwaway test key (hardhat account #1) — never holds funds.
const TEST_PRIV_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

let testWallet: ethers.Wallet;
let legacyKeystore: string; // N=8192, as created before commit 0823a61
let upgradedKeystore: string;

beforeAll(async () => {
  testWallet = new ethers.Wallet(TEST_PRIV_KEY);
  legacyKeystore = await encryptKeystoreJson(
    { address: testWallet.address, privateKey: testWallet.privateKey },
    PASSWORD,
    { scrypt: { N: 8192 } },
  );
  upgradedKeystore = (await upgradeKeystore(legacyKeystore, PASSWORD))!;
}, SLOW);

describe('keystore scrypt migration (N=8192 → N=131072)', () => {
  it('legacy keystore reports its weak scrypt cost', () => {
    expect(keystoreScryptN(legacyKeystore)).toBe(8192);
  });

  it('upgrades to the current standard cost', () => {
    expect(upgradedKeystore).not.toBeNull();
    expect(keystoreScryptN(upgradedKeystore)).toBe(KEYSTORE_SCRYPT_N);
  });

  it(
    'preserves the address and private key exactly',
    async () => {
      const restored = await ethers.Wallet.fromEncryptedJson(upgradedKeystore, PASSWORD);
      expect(restored.address).toBe(testWallet.address);
      expect(restored.privateKey).toBe(testWallet.privateKey);
    },
    SLOW,
  );

  it('leaves already-strong keystores untouched (returns null)', async () => {
    expect(await upgradeKeystore(upgradedKeystore, PASSWORD)).toBeNull();
  });

  it('throws on a wrong password without producing output', async () => {
    await expect(upgradeKeystore(legacyKeystore, 'wrong-password')).rejects.toThrow();
  });

  it(
    'upgradeStoredKeystoreIfWeak migrates localStorage in place, once',
    async () => {
      localStorage.setItem('wallet_keystore', legacyKeystore);

      const migrated = await upgradeStoredKeystoreIfWeak(PASSWORD);
      expect(migrated).toBe(true);
      const stored = localStorage.getItem('wallet_keystore')!;
      expect(keystoreScryptN(stored)).toBe(KEYSTORE_SCRYPT_N);

      // Second call is a no-op — already strong.
      expect(await upgradeStoredKeystoreIfWeak(PASSWORD)).toBe(false);

      // Wrong password must not corrupt the stored keystore.
      localStorage.setItem('wallet_keystore', legacyKeystore);
      expect(await upgradeStoredKeystoreIfWeak('wrong-password')).toBe(false);
      expect(localStorage.getItem('wallet_keystore')).toBe(legacyKeystore);

      localStorage.removeItem('wallet_keystore');
    },
    SLOW,
  );
});
