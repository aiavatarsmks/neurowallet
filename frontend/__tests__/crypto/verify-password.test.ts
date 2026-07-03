/**
 * verifyWalletPassword (фикс PIN после переезда домена): проверка пароля
 * кошелька по любому per-chain блобу, без разблокировки UI.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { encryptBytes } from '@/lib/crypto/aes';
import { verifyWalletPassword } from '@/lib/pin';

const PASSWORD = 'correct-horse-battery';
const SLOW = 120_000;

describe('verifyWalletPassword', () => {
  beforeEach(() => {
    for (const k of ['wallet_sol_enc', 'wallet_btc_enc', 'wallet_tron_enc', 'wallet_ton_enc']) {
      localStorage.removeItem(k);
    }
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
});
