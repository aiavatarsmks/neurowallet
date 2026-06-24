/**
 * Security utilities for NeuroWallet.
 * All wallet private key operations must stay client-side only (never sent to server).
 * Sensitive values must never be logged or stored in plaintext.
 */

// ─── HTTPS enforcement ──────────────────────────────────────────────────────

export function assertHttps(): void {
  if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    window.location.replace(`https://${window.location.host}${window.location.pathname}`);
  }
}

// ─── Safe localStorage wrapper ──────────────────────────────────────────────

const LS_PREFIX = 'nw_';

export const safeStorage = {
  set(key: string, value: string): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(`${LS_PREFIX}${key}`, value);
    } catch {
      // Silently fail — storage quota or private mode
    }
  },

  get(key: string): string | null {
    try {
      if (typeof window === 'undefined') return null;
      return localStorage.getItem(`${LS_PREFIX}${key}`);
    } catch {
      return null;
    }
  },

  remove(key: string): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.removeItem(`${LS_PREFIX}${key}`);
    } catch {
      // Silently fail
    }
  },

  clear(): void {
    try {
      if (typeof window === 'undefined') return;
      Object.keys(localStorage)
        .filter((k) => k.startsWith(LS_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // Silently fail
    }
  },
};

// ─── Input sanitization ─────────────────────────────────────────────────────

export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/[<>]/g, '')         // strip angle brackets (basic XSS prevention)
    .slice(0, 1000);              // hard cap to prevent oversized inputs
}

export function sanitizeAmount(input: unknown): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  // Round to 8 decimal places (BTC precision)
  return Math.round(n * 1e8) / 1e8;
}

export function sanitizeAddress(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  // Basic address format: 0x hex (ETH) or base58 (SOL/BTC)
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed;
  if (/^[1-9A-HJ-NP-Za-km-z]{25,62}$/.test(trimmed)) return trimmed;
  return null;
}

// ─── Mnemonic security helpers ──────────────────────────────────────────────

export function validateMnemonicWordCount(phrase: string): boolean {
  const wordCount = phrase.trim().split(/\s+/).length;
  return wordCount === 12 || wordCount === 24;
}

export function clearSensitiveString(str: string): void {
  // JS strings are immutable, but this signals intent to GC
  // For real zeroing, use TypedArray (see wallet.ts for keystore handling)
  str = '';
  void str;
}
