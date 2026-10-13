/**
 * PIN lock for NeuroWallet (UI lock, not key protection).
 *
 * Architecture (v2):
 *   PIN (4 digits) → PBKDF2 key → AES-GCM encrypt(fixed marker 'nw-pin-verifier-v2')
 *   Stored as `wallet_pin_blob` in localStorage.
 *
 * The blob is a pure verifier: it proves "this is the PIN that was set" and
 * contains nothing secret. The wallet keys are protected only by the wallet
 * password (scrypt keystore + PBKDF2/AES-GCM per-chain blobs), and every send
 * asks for that password again (CryptoSendScreen), so the PIN never needs to
 * hold it.
 *
 * Why not the old design: v1 stored the WALLET PASSWORD under the 4-digit PIN.
 * The GCM tag is a perfect oracle, so anyone who copied localStorage (XSS, a
 * compromised dependency, disk access to the WebView profile) could try all
 * 10^4 PINs offline in minutes and recover the password that decrypts every
 * key. v1 blobs are migrated to v2 on the first successful verifyPin().
 *
 * A 4-digit PIN is still brute-forceable offline against the verifier, but
 * that only "unlocks" the UI gate, which an attacker with storage access can
 * skip anyway. Keys stay behind the password.
 *
 * Rate limiting (UI only, client-side counters): max 5 wrong attempts → 30 min lockout.
 */

import { encryptBytes, decryptBytes } from './crypto/aes';

const PIN_BLOB_KEY      = 'wallet_pin_blob';
const PIN_ATTEMPTS_KEY  = 'wallet_pin_attempts';
const PIN_LOCKOUT_KEY   = 'wallet_pin_lockout_until';

const MAX_ATTEMPTS      = 5;
const LOCKOUT_MS        = 30 * 60 * 1000; // 30 minutes

/** Plaintext of a v2 PIN blob. Not a secret; it only makes the blob checkable. */
export const PIN_VERIFIER_MARKER = 'nw-pin-verifier-v2';

function markerBytes(): Uint8Array {
  return new TextEncoder().encode(PIN_VERIFIER_MARKER);
}

function isVerifier(bytes: Uint8Array): boolean {
  const m = markerBytes();
  if (bytes.length !== m.length) return false;
  let diff = 0;
  for (let i = 0; i < m.length; i++) diff |= bytes[i] ^ m[i];
  return diff === 0;
}

async function writeVerifierBlob(pin: string): Promise<void> {
  const blob = await encryptBytes(markerBytes(), pin);
  localStorage.setItem(PIN_BLOB_KEY, blob);
}

// ── Public helpers ─────────────────────────────────────────────────────────────

/** Returns true if user has set up a PIN */
export function hasPinSetup(): boolean {
  return !!localStorage.getItem(PIN_BLOB_KEY);
}

/**
 * Set (or replace) the PIN. Stores only a verifier blob, never the wallet
 * password. Callers must have checked the wallet password (verifyWalletPassword)
 * before letting the user change the PIN; that check lives in the UI.
 *
 * The two-argument form is kept for call-site compatibility: the password
 * argument is ignored and never stored.
 */
export async function setupPin(pin: string): Promise<void>;
/** @deprecated The wallet password argument is ignored; call setupPin(pin). */
export async function setupPin(walletPassword: string, pin: string): Promise<void>;
export async function setupPin(first: string, second?: string): Promise<void> {
  const pin = second ?? first;
  await writeVerifierBlob(pin);
  localStorage.removeItem(PIN_ATTEMPTS_KEY);
  localStorage.removeItem(PIN_LOCKOUT_KEY);
}

/** Remove PIN (e.g. when user resets wallet) */
export function clearPin(): void {
  localStorage.removeItem(PIN_BLOB_KEY);
  localStorage.removeItem(PIN_ATTEMPTS_KEY);
  localStorage.removeItem(PIN_LOCKOUT_KEY);
}

/** Check if currently locked out. Returns ms remaining (0 if not locked). */
export function getLockoutMs(): number {
  const until = parseInt(localStorage.getItem(PIN_LOCKOUT_KEY) ?? '0', 10);
  return Math.max(0, until - Date.now());
}

/** Returns remaining attempts before lockout */
export function getRemainingAttempts(): number {
  const used = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) ?? '0', 10);
  return Math.max(0, MAX_ATTEMPTS - used);
}

/**
 * Проверка пароля кошелька без разблокировки UI: пробуем расшифровать любой
 * per-chain блоб (PBKDF2+AES-GCM, ~1 с). Нужна для флоу «установить/сменить
 * PIN» из Security center и для «Забыли PIN?» на экране PIN. Ключ сразу
 * зануляется. false: неверный пароль ИЛИ в localStorage нет ни одного блоба.
 */
export async function verifyWalletPassword(password: string): Promise<boolean> {
  if (typeof window === 'undefined' || !password) return false;
  for (const key of ['wallet_sol_enc', 'wallet_btc_enc', 'wallet_tron_enc', 'wallet_ton_enc']) {
    const blob = localStorage.getItem(key);
    if (!blob) continue;
    try {
      const bytes = await decryptBytes(blob, password);
      bytes.fill(0);
      return true;
    } catch {
      return false; // блоб есть, пароль не подошёл
    }
  }
  // Fallback: legacy-кошельки (созданные до per-chain enc-схемы) держат только
  // ETH-keystore, per-chain блобов нет. Без этой ветки verifyWalletPassword
  // возвращал бы false на ЛЮБОЙ ввод: юзер не мог установить PIN и думал, что
  // «забыл пароль». Проверяем против keystore (scrypt, ~1 с).
  const ks = localStorage.getItem('wallet_keystore');
  if (ks) {
    try {
      const { ethers } = await import('ethers');
      await ethers.Wallet.fromEncryptedJson(ks, password);
      return true;
    } catch {
      return false; // keystore есть, пароль не подошёл
    }
  }
  return false; // проверять нечем, ключей в этом origin нет
}

/**
 * Verify the PIN. Resolves on success, throws on wrong PIN or lockout
 * (`WRONG:<left>` / `LOCKED:<mins>`). Returns nothing: the PIN unlocks the UI,
 * it does not hand out the wallet password.
 *
 * A legacy v1 blob (plaintext = wallet password) is accepted once and replaced
 * with a v2 verifier right away. The migration is best-effort: if the write
 * throws, the unlock still succeeds and the next unlock retries.
 */
export async function verifyPin(pin: string): Promise<void> {
  // Check lockout
  if (getLockoutMs() > 0) {
    const mins = Math.ceil(getLockoutMs() / 60_000);
    throw new Error(`LOCKED:${mins}`);
  }

  const blob = localStorage.getItem(PIN_BLOB_KEY);
  if (!blob) throw new Error('PIN не настроен');

  let bytes: Uint8Array;
  try {
    bytes = await decryptBytes(blob, pin);
  } catch {
    // Wrong PIN — increment counter
    const used = parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) ?? '0', 10) + 1;
    localStorage.setItem(PIN_ATTEMPTS_KEY, String(used));

    if (used >= MAX_ATTEMPTS) {
      const lockUntil = Date.now() + LOCKOUT_MS;
      localStorage.setItem(PIN_LOCKOUT_KEY, String(lockUntil));
      throw new Error('LOCKED:30');
    }

    throw new Error(`WRONG:${MAX_ATTEMPTS - used}`);
  }

  try {
    // Success — reset counter
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
    localStorage.removeItem(PIN_LOCKOUT_KEY);

    if (!isVerifier(bytes)) {
      // Legacy v1 blob: the plaintext is the wallet password. Overwrite it with
      // a verifier now so the password no longer sits under a 4-digit PIN.
      try {
        await writeVerifierBlob(pin);
      } catch {
        /* best-effort: never fail the unlock because of the migration write */
      }
    }
  } finally {
    bytes.fill(0);
  }
}
