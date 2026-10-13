/**
 * lib/legacy-storage-cleanup.ts: the snapshot taken before any destructive
 * wallet action (nw_wallet_backup_v1), the confirmed "remove from device"
 * reset and the create/import overwrite decision. The ETH-address derivation
 * used for that decision is tested in __tests__/crypto/eth-address-from-mnemonic.test.ts
 * (node environment: ethers' mnemonic code breaks under the jsdom realm).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  backupWalletStorage,
  readWalletBackup,
  removeWalletFromDevice,
  importOverwriteKind,
  clearLegacyXorKeys,
  purgeExpiredWalletBackup,
  WALLET_BACKUP_STORAGE_KEY,
  WALLET_BACKUP_TTL_MS,
  WALLET_STORAGE_KEYS,
} from '@/lib/legacy-storage-cleanup';

const WALLET = {
  wallet_eth_address: '0xAbC0000000000000000000000000000000000001',
  wallet_sol_address: 'So1Address',
  wallet_btc_address: 'bc1qaddress',
  wallet_tron_address: 'TAddress',
  wallet_ton_address: 'UQAddress',
  wallet_keystore: '{"version":3}',
  wallet_sol_enc: 'sol-blob',
  wallet_btc_enc: 'btc-blob',
  wallet_tron_enc: 'tron-blob',
  wallet_ton_enc: 'ton-blob',
  wallet_ton_scheme: 'slip10-607-0-0',
};

function seedWallet(): void {
  for (const [k, v] of Object.entries(WALLET)) localStorage.setItem(k, v);
}

describe('backupWalletStorage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('snapshots addresses, encrypted blobs and the TON scheme as {at, expiresAt, keys}', () => {
    seedWallet();
    const at = new Date('2026-10-13T01:02:03.000Z');
    expect(backupWalletStorage(at)).toBe(true);

    const raw = JSON.parse(localStorage.getItem(WALLET_BACKUP_STORAGE_KEY)!);
    expect(raw.at).toBe('2026-10-13T01:02:03.000Z');
    expect(raw.expiresAt).toBe('2026-11-12T01:02:03.000Z'); // at + 30 days
    expect(raw.keys).toEqual(WALLET);
    expect(readWalletBackup()).toEqual({ at: raw.at, expiresAt: raw.expiresAt, keys: WALLET });
  });

  it('does not copy the PIN blob, the XOR-era blobs or unrelated keys', () => {
    seedWallet();
    localStorage.setItem('wallet_pin_blob', 'maybe-legacy-password-under-pin');
    localStorage.setItem('wallet_pin_attempts', '2');
    localStorage.setItem('wallet_sol_xor', 'xor');
    localStorage.setItem('wallet_language', 'ru');
    localStorage.setItem('nw_demo', 'true');

    backupWalletStorage();
    const keys = Object.keys(readWalletBackup()!.keys);
    expect(keys).not.toContain('wallet_pin_blob');
    expect(keys).not.toContain('wallet_pin_attempts');
    expect(keys).not.toContain('wallet_sol_xor');
    expect(keys).not.toContain('wallet_language');
    expect(keys).not.toContain('nw_demo');
  });

  it('keeps only the latest snapshot', () => {
    seedWallet();
    backupWalletStorage(new Date('2026-10-01T00:00:00.000Z'));
    localStorage.setItem('wallet_eth_address', '0xNEW');
    backupWalletStorage(new Date('2026-10-02T00:00:00.000Z'));
    const b = readWalletBackup()!;
    expect(b.at).toBe('2026-10-02T00:00:00.000Z');
    expect(b.keys.wallet_eth_address).toBe('0xNEW');
  });

  it('with nothing to back up, writes nothing and keeps the older snapshot', () => {
    seedWallet();
    backupWalletStorage(new Date('2026-10-01T00:00:00.000Z'));
    for (const k of Object.keys(WALLET)) localStorage.removeItem(k);

    expect(backupWalletStorage()).toBe(false);
    expect(readWalletBackup()!.at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('skips (returns false, does not throw) when the write exceeds the quota', () => {
    seedWallet();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === WALLET_BACKUP_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, k, v);
    });
    expect(() => backupWalletStorage()).not.toThrow();
    expect(backupWalletStorage()).toBe(false);
    expect(localStorage.getItem(WALLET_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it('readWalletBackup returns null for a malformed entry', () => {
    localStorage.setItem(WALLET_BACKUP_STORAGE_KEY, '{not json');
    expect(readWalletBackup()).toBeNull();
  });
});

describe('purgeExpiredWalletBackup (run on app start)', () => {
  const AT = new Date('2026-10-13T00:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  beforeEach(() => localStorage.clear());

  it('keeps a backup younger than 30 days, deletes it once expired', () => {
    seedWallet();
    backupWalletStorage(AT);
    expect(purgeExpiredWalletBackup(new Date(AT.getTime() + 29 * day))).toBe(false);
    expect(localStorage.getItem(WALLET_BACKUP_STORAGE_KEY)).not.toBeNull();
    expect(purgeExpiredWalletBackup(new Date(AT.getTime() + WALLET_BACKUP_TTL_MS))).toBe(true);
    expect(localStorage.getItem(WALLET_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it('a backup written before expiresAt existed expires at + 30 days', () => {
    localStorage.setItem(WALLET_BACKUP_STORAGE_KEY, JSON.stringify({ at: AT.toISOString(), keys: WALLET }));
    expect(readWalletBackup()!.expiresAt).toBe('2026-11-12T00:00:00.000Z');
    expect(purgeExpiredWalletBackup(new Date(AT.getTime() + 10 * day))).toBe(false);
    expect(purgeExpiredWalletBackup(new Date(AT.getTime() + 31 * day))).toBe(true);
    expect(localStorage.getItem(WALLET_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it('leaves an entry it cannot date alone and never throws', () => {
    localStorage.setItem(WALLET_BACKUP_STORAGE_KEY, '{not json');
    expect(purgeExpiredWalletBackup(new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
    localStorage.setItem(WALLET_BACKUP_STORAGE_KEY, JSON.stringify({ keys: WALLET }));
    expect(purgeExpiredWalletBackup(new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
    expect(localStorage.getItem(WALLET_BACKUP_STORAGE_KEY)).not.toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => purgeExpiredWalletBackup()).not.toThrow();
    vi.restoreAllMocks();
  });

  it('touches nothing but the backup', () => {
    seedWallet();
    backupWalletStorage(AT);
    purgeExpiredWalletBackup(new Date(AT.getTime() + 60 * day));
    expect(localStorage.getItem('wallet_keystore')).toBe(WALLET.wallet_keystore);
  });
});

describe('removeWalletFromDevice', () => {
  beforeEach(() => localStorage.clear());

  it('backs up first, then removes every wallet key and keeps unrelated ones', () => {
    seedWallet();
    localStorage.setItem('wallet_pin_blob', 'pin');
    localStorage.setItem('wallet_pin_lockout_until', '123');
    localStorage.setItem('wallet_ton_xor', 'xor');
    localStorage.setItem('wallet_language', 'ru');
    localStorage.setItem('nw_display_currency', 'EUR');

    removeWalletFromDevice();

    for (const k of WALLET_STORAGE_KEYS) expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem('wallet_language')).toBe('ru');
    expect(localStorage.getItem('nw_display_currency')).toBe('EUR');
    expect(readWalletBackup()!.keys).toEqual(WALLET);
  });
});

describe('importOverwriteKind (?recover=1 address check)', () => {
  beforeEach(() => localStorage.clear());

  it("'empty' when no wallet is stored", () => {
    expect(importOverwriteKind('0xabc')).toBe('empty');
    expect(importOverwriteKind('0xabc', null)).toBe('empty');
  });

  it("'same' for the same ETH address, case-insensitive (re-import proceeds silently)", () => {
    localStorage.setItem('wallet_eth_address', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(importOverwriteKind('0x9858effd232b4033e47d90003d41ec34ecaeda94')).toBe('same');
  });

  it("'different' for another wallet (needs explicit confirmation)", () => {
    localStorage.setItem('wallet_eth_address', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(importOverwriteKind('0x0000000000000000000000000000000000000001')).toBe('different');
  });
});

describe('clearLegacyXorKeys (light module)', () => {
  it('removes the XOR blobs only', () => {
    localStorage.setItem('wallet_sol_xor', 'x');
    localStorage.setItem('wallet_eth_address', '0xabc');
    clearLegacyXorKeys();
    expect(localStorage.getItem('wallet_sol_xor')).toBeNull();
    expect(localStorage.getItem('wallet_eth_address')).toBe('0xabc');
    localStorage.clear();
  });
});
