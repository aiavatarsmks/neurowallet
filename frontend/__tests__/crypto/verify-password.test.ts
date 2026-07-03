/**
 * verifyWalletPassword (фикс PIN после переезда домена): проверка пароля
 * кошелька по любому per-chain блобу, без разблокировки UI.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { ethers, encryptKeystoreJson } from 'ethers';
import { encryptBytes } from '@/lib/crypto/aes';
import { verifyWalletPassword } from '@/lib/pin';

const PASSWORD = 'correct-horse-battery';
const SLOW = 120_000;

const WALLET_KEYS = [
  'wallet_sol_enc',
  'wallet_btc_enc',
  'wallet_tron_enc',
  'wallet_ton_enc',
  'wallet_keystore',
];

// Well-known throwaway test key (hardhat account #1) — never holds funds.
// Keystore is built at the weak N=8192 cost purely to keep the test fast;
// verifyWalletPassword reads N from the JSON, so decryption cost matches.
const TEST_PRIV_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
let legacyKeystore: string;

beforeAll(async () => {
  const w = new ethers.Wallet(TEST_PRIV_KEY);
  legacyKeystore = await encryptKeystoreJson(
    { address: w.address, privateKey: w.privateKey },
    PASSWORD,
    { scrypt: { N: 8192 } },
  );
}, SLOW);

describe('verifyWalletPassword', () => {
  beforeEach(() => {
    for (const k of WALLET_KEYS) localStorage.removeItem(k);
  });

  it(
    'true на верный пароль, false на неверный (по первому доступному блобу)',
    async () => {
      const blob = await encryptBytes(new Uint8Array(32).fill(7), PASSWORD);
      localStorage.setItem('wallet_btc_enc', blob);
      expect(await verifyWalletPassword(PASSWORD)).toBe(true);
      expect(await verifyWalletPassword('wrong-password')).toBe(false);
      expect(await verifyWalletPassword('')).toBe(false);
    },
    SLOW,
  );

  it('false, когда кошелька в localStorage нет вообще', async () => {
    expect(await verifyWalletPassword(PASSWORD)).toBe(false);
  });

  // Legacy-кошельки (до per-chain enc-схемы) держат только ETH-keystore.
  // Без fallback verifyWalletPassword возвращал бы false на ЛЮБОЙ ввод —
  // пользователь не мог поставить PIN и думал, что «забыл пароль».
  it(
    'fallback на ETH-keystore, когда per-chain блобов нет: верный → true, неверный → false',
    async () => {
      localStorage.setItem('wallet_keystore', legacyKeystore);
      expect(await verifyWalletPassword(PASSWORD)).toBe(true);
      expect(await verifyWalletPassword('wrong-password')).toBe(false);
    },
    SLOW,
  );

  it(
    'per-chain блоб имеет приоритет над keystore (неверный пароль не «дотягивается» до keystore)',
    async () => {
      // enc-блоб зашифрован ДРУГИМ паролем, keystore — на PASSWORD.
      // Неверный для блоба пароль обязан дать false, не проваливаясь в keystore.
      const blob = await encryptBytes(new Uint8Array(32).fill(7), 'enc-only-password');
      localStorage.setItem('wallet_sol_enc', blob);
      localStorage.setItem('wallet_keystore', legacyKeystore);
      expect(await verifyWalletPassword('enc-only-password')).toBe(true);
      expect(await verifyWalletPassword(PASSWORD)).toBe(false);
    },
    SLOW,
  );

  it('false на пустой пароль даже при наличии keystore', async () => {
    localStorage.setItem('wallet_keystore', legacyKeystore);
    expect(await verifyWalletPassword('')).toBe(false);
  });
});
