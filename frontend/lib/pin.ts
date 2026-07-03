/**
 * PIN authentication for NeuroWallet
 *
 * Architecture:
 *   PIN (4 digits) → PBKDF2 key → AES-GCM encrypt(wallet_password)
 *   Stored as `wallet_pin_blob` in localStorage.
 *
 * The actual wallet keys are still protected by the full wallet password.
 * PIN just stores the full password in an encrypted envelope so the user
 * doesn't have to type it every time.
 *
 * Rate limiting: max 5 wrong attempts → 30 min lockout.
 */

import { encryptBytes, decryptBytes } from './crypto/aes';

const PIN_BLOB_KEY      = 'wallet_pin_blob';
const PIN_ATTEMPTS_KEY  = 'wallet_pin_attempts';
const PIN_LOCKOUT_KEY   = 'wallet_pin_lockout_until';

const MAX_ATTEMPTS      = 5;
const LOCKOUT_MS        = 30 * 60 * 1000; // 30 minutes

// ── Public helpers ─────────────────────────────────────────────────────────────

/** Returns true if user has set up a PIN */
export function hasPinSetup(): boolean {
  return !!localStorage.getItem(PIN_BLOB_KEY);
}

/** Set up PIN by encrypting the wallet password */
export async function setupPin(walletPassword: string, pin: string): Promise<void> {
  const enc   = new TextEncoder();
  const blob  = await encryptBytes(enc.encode(walletPassword), pin);
  localStorage.setItem(PIN_BLOB_KEY, blob);
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
 * PIN» из Security center (задача-фикс после переезда домена). Ключ сразу
 * зануляется. false — неверный пароль ИЛИ в localStorage нет ни одного блоба.
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
  // возвращал бы false на ЛЮБОЙ ввод — юзер не мог установить PIN и думал, что
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
  return false; // проверять нечем — ключей в этом origin нет
}

/**
 * Verify PIN and return decrypted wallet password.
 * Throws on wrong PIN or lockout.
 */
export async function verifyPin(pin: string): Promise<string> {
  // Check lockout
  if (getLockoutMs() > 0) {
    const mins = Math.ceil(getLockoutMs() / 60_000);
    throw new Error(`LOCKED:${mins}`);
  }

  const blob = localStorage.getItem(PIN_BLOB_KEY);
  if (!blob) throw new Error('PIN не настроен');

  try {
    const bytes    = await decryptBytes(blob, pin);
    const password = new TextDecoder().decode(bytes);
    // Success — reset counter
    localStorage.removeItem(PIN_ATTEMPTS_KEY);
    localStorage.removeItem(PIN_LOCKOUT_KEY);
    return password;
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
}
