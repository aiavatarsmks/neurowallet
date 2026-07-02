/**
 * lib/crypto/keystore-migration.ts
 * One-time client-side upgrade of legacy ETH keystores.
 *
 * Keystores created before commit 0823a61 were encrypted with scrypt N=8192.
 * ethers reads the kdf params from the keystore JSON itself, so those blobs
 * still decrypt fine — but at a weaker work factor than the current standard.
 * On the first successful unlock we re-encrypt with N=131072 (2^17) and
 * replace the stored blob. Runs entirely in the browser; the private key
 * never leaves memory and is not persisted in plaintext at any point.
 */

import { ethers, encryptKeystoreJson } from 'ethers';

export const KEYSTORE_SCRYPT_N = 131072;

const LS_KEYSTORE = 'wallet_keystore';

/** Reads the scrypt cost parameter from a keystore JSON, or null if unreadable. */
export function keystoreScryptN(keystoreJson: string): number | null {
  try {
    const parsed = JSON.parse(keystoreJson);
    const n = parsed?.crypto?.kdfparams?.n ?? parsed?.Crypto?.kdfparams?.n;
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

/**
 * Re-encrypts a keystore that uses a weaker scrypt cost with `targetN`.
 * Returns the upgraded keystore JSON, or null if no upgrade is needed.
 * Throws if the password is wrong (nothing is modified in that case).
 */
export async function upgradeKeystore(
  keystoreJson: string,
  password: string,
  targetN: number = KEYSTORE_SCRYPT_N,
): Promise<string | null> {
  const n = keystoreScryptN(keystoreJson);
  if (n !== null && n >= targetN) return null;

  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  return encryptKeystoreJson(
    { address: wallet.address, privateKey: wallet.privateKey },
    password,
    { scrypt: { N: targetN } },
  );
}

/**
 * Upgrades the keystore stored in localStorage if it is weaker than the
 * current standard. Returns true when a migration actually happened.
 * Never throws — a failed migration must not break the calling flow
 * (the old keystore keeps working as before).
 */
export async function upgradeStoredKeystoreIfWeak(password: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const keystoreJson = localStorage.getItem(LS_KEYSTORE);
  if (!keystoreJson) return false;

  try {
    const upgraded = await upgradeKeystore(keystoreJson, password);
    if (!upgraded) return false;
    localStorage.setItem(LS_KEYSTORE, upgraded);
    return true;
  } catch (err) {
    console.warn('[keystore-migration] skipped:', err instanceof Error ? err.message : err);
    return false;
  }
}
