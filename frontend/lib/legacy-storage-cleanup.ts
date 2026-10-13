/**
 * lib/legacy-storage-cleanup.ts — light localStorage helpers for wallet data.
 *
 * Deliberately has NO imports: pages/_app.tsx and components/ErrorBoundary.tsx
 * load it on every route, and importing lib/crypto/wallet.ts there used to drag
 * ethers, bip39, @ton/ton and bitcoinjs-lib into the shared _app chunk.
 *
 * Contents:
 *  - clearLegacyXorKeys(): purge XOR-era blobs (scheme removed in 4b3704e).
 *  - WALLET_STORAGE_KEYS: every localStorage key that belongs to the wallet
 *    (single list for the reset paths in ErrorBoundary and pages/wallet.tsx).
 *  - backupWalletStorage(): snapshot of the encrypted key blobs, addresses and
 *    scheme flag into 'nw_wallet_backup_v1' before anything deletes or
 *    overwrites them. Never contains the seed (the app does not store it).
 *    Kept 30 days (expiresAt), so a mistaken reset can still be undone.
 *  - purgeExpiredWalletBackup(): drop that snapshot once it has expired
 *    (run on every app start from pages/_app.tsx).
 *  - importOverwriteKind(): would writing a wallet with this ETH address
 *    replace a different wallet already on this device?
 */

// ── Legacy XOR cleanup ─────────────────────────────────────────────────────────

// Legacy XOR-scheme blobs (scheme removed in commit 4b3704e). No code reads
// them anymore; test wallets from that era must re-import from mnemonic.
// Purged on every app start so stale key-derived material doesn't linger
// in localStorage.
export const LEGACY_XOR_KEYS = ['wallet_sol_xor', 'wallet_btc_xor', 'wallet_tron_xor', 'wallet_ton_xor'];

export function clearLegacyXorKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    LEGACY_XOR_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}

// ── Wallet key registry ────────────────────────────────────────────────────────

/** Wallet data worth keeping in a backup: addresses, encrypted key blobs, TON scheme. */
export const WALLET_BACKUP_KEYS = [
  'wallet_eth_address', 'wallet_sol_address', 'wallet_btc_address',
  'wallet_tron_address', 'wallet_ton_address',
  'wallet_keystore',
  'wallet_sol_enc', 'wallet_btc_enc', 'wallet_tron_enc', 'wallet_ton_enc',
  'wallet_ton_scheme',
] as const;

/** PIN lock state (lib/pin.ts). */
export const PIN_STORAGE_KEYS = ['wallet_pin_blob', 'wallet_pin_attempts', 'wallet_pin_lockout_until'] as const;

/**
 * Everything a "remove the wallet from this device" reset deletes. Unrelated
 * keys (language, display currency, demo progress, the backup itself) stay.
 */
export const WALLET_STORAGE_KEYS: readonly string[] = [
  ...WALLET_BACKUP_KEYS,
  ...PIN_STORAGE_KEYS,
  ...LEGACY_XOR_KEYS,
];

// ── Backup before destructive actions ──────────────────────────────────────────

export const WALLET_BACKUP_STORAGE_KEY = 'nw_wallet_backup_v1';

/**
 * How long a backup stays on the device. The reset confirmation tells the
 * user so; purgeExpiredWalletBackup() (run on app start) enforces it.
 */
export const WALLET_BACKUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface WalletBackup {
  /** ISO timestamp of the snapshot. */
  at: string;
  /** ISO timestamp after which the snapshot is deleted (at + 30 days). */
  expiresAt: string;
  /** localStorage key → value, only keys that were present. */
  keys: Record<string, string>;
}

/** Expiry of a stored backup; older entries without expiresAt use at + TTL. NaN if unreadable. */
function backupExpiryMs(b: { at?: unknown; expiresAt?: unknown }): number {
  if (typeof b.expiresAt === 'string') return Date.parse(b.expiresAt);
  if (typeof b.at === 'string') return Date.parse(b.at) + WALLET_BACKUP_TTL_MS;
  return NaN;
}

/**
 * Copy the wallet's localStorage entries into one 'nw_wallet_backup_v1' entry
 * (only the latest snapshot is kept). Call right before deleting or
 * overwriting wallet data.
 *
 * Not included on purpose:
 *  - the PIN blob and counters: a PIN blob written before the v2 verifier
 *    (lib/pin.ts) holds the wallet password under a 4-digit PIN, and copying
 *    it would keep that weakness alive. Restored keys only need the password;
 *    a new PIN is set after it.
 *  - the legacy XOR blobs (key material derived from the ETH key).
 *
 * Returns true if a snapshot was written. Returns false (and leaves any older
 * snapshot untouched) when there is nothing to back up, storage is
 * unavailable, or the write would exceed the quota.
 */
export function backupWalletStorage(now: Date = new Date()): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const keys: Record<string, string> = {};
    for (const k of WALLET_BACKUP_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) keys[k] = v;
    }
    if (Object.keys(keys).length === 0) return false; // never clobber a useful backup with an empty one
    const backup: WalletBackup = {
      at: now.toISOString(),
      expiresAt: new Date(now.getTime() + WALLET_BACKUP_TTL_MS).toISOString(),
      keys,
    };
    localStorage.setItem(WALLET_BACKUP_STORAGE_KEY, JSON.stringify(backup));
    return true;
  } catch {
    // QuotaExceededError or storage disabled: skip the backup, the caller
    // already showed the user an explicit seed-phrase warning.
    return false;
  }
}

/**
 * Read the last snapshot, or null if there is none or it is malformed.
 * Expiry is enforced by purgeExpiredWalletBackup() on app start.
 */
export function readWalletBackup(): WalletBackup | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WALLET_BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WalletBackup>;
    if (typeof parsed?.at !== 'string' || !parsed.keys || typeof parsed.keys !== 'object') return null;
    const expiry = backupExpiryMs(parsed);
    if (Number.isNaN(expiry)) return null;
    return { at: parsed.at, expiresAt: new Date(expiry).toISOString(), keys: parsed.keys as Record<string, string> };
  } catch {
    return null;
  }
}

/**
 * Delete the backup once it has expired (expiresAt, or at + 30 days for
 * snapshots written before expiresAt existed). Called on every app start
 * (pages/_app.tsx). Keeps a fresh backup and leaves an entry it cannot date
 * alone. Returns true if a backup was removed. Never throws.
 */
export function purgeExpiredWalletBackup(now: Date = new Date()): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(WALLET_BACKUP_STORAGE_KEY);
    if (!raw) return false;
    let parsed: { at?: unknown; expiresAt?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { at?: unknown; expiresAt?: unknown } | null;
    } catch {
      return false; // unreadable: not ours to judge
    }
    if (!parsed || typeof parsed !== 'object') return false;
    const expiry = backupExpiryMs(parsed);
    if (Number.isNaN(expiry) || expiry > now.getTime()) return false;
    localStorage.removeItem(WALLET_BACKUP_STORAGE_KEY);
    return true;
  } catch {
    return false; // storage unavailable
  }
}

/**
 * Back up, then remove every wallet key from this device. Used by the
 * confirmed reset paths (ErrorBoundary, PIN-setup gate).
 */
export function removeWalletFromDevice(): void {
  if (typeof window === 'undefined') return;
  backupWalletStorage();
  try {
    for (const k of WALLET_STORAGE_KEYS) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
}

// ── Overwrite check for create/import ──────────────────────────────────────────

export type OverwriteKind = 'empty' | 'same' | 'different';

/**
 * Compare the wallet about to be written with the one on this device.
 *  - 'empty': no wallet stored, nothing to replace;
 *  - 'same': same ETH address (re-import of the same phrase), proceed silently;
 *  - 'different': another wallet would be replaced, ask the user first.
 * Pass existingEth explicitly in tests; by default it is read from storage.
 */
export function importOverwriteKind(
  newEthAddress: string,
  existingEth: string | null = readStoredEthAddress(),
): OverwriteKind {
  if (!existingEth) return 'empty';
  return existingEth.trim().toLowerCase() === newEthAddress.trim().toLowerCase() ? 'same' : 'different';
}

export function readStoredEthAddress(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('wallet_eth_address');
  } catch {
    return null;
  }
}
