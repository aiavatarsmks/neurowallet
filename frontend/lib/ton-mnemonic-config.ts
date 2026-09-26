/**
 * lib/ton-mnemonic-config.ts — feature flag for the Tonkeeper-compatible TON
 * scheme (DECISION_TON_DERIVATION.md, variant B). No secrets — client + server safe.
 *
 * Flag ON (Vercel env NEXT_PUBLIC_TON_MNEMONIC_ENABLED=true):
 *   - new wallets get a 24-word phrase valid both as BIP39 and as a TON mnemonic;
 *   - import accepts 12 or 24 words;
 *   - TON addresses are shown non-bounceable (UQ…);
 *   - Security center warns legacy (12-word) wallets that TON restores only here.
 * Flag OFF (default): previous behaviour — 12-word phrases, EQ… display.
 *
 * NOTE: the TON *derivation scheme* on import is decided by the phrase itself
 * (24 words + TON-valid → TON standard), not by this flag — so toggling the flag
 * never silently changes an existing wallet's TON address on re-import.
 * Rollout gate: manual Tonkeeper import check (DECISION doc, step 4) first.
 */
export function tonMnemonicEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TON_MNEMONIC_ENABLED === 'true';
}

/** TON key scheme of a stored wallet (localStorage `wallet_ton_scheme`). */
export type TonScheme = 'ton-mnemonic-v4r2' | 'slip10-607-0-0';
export const TON_SCHEME_NATIVE: TonScheme = 'ton-mnemonic-v4r2';
/** Absent key = every wallet created before this scheme existed. */
export const TON_SCHEME_LEGACY: TonScheme = 'slip10-607-0-0';
export const TON_SCHEME_STORAGE_KEY = 'wallet_ton_scheme';

export function readStoredTonScheme(): TonScheme | null {
  if (typeof window === 'undefined') return null;
  if (!localStorage.getItem('wallet_ton_address')) return null; // no wallet
  const v = localStorage.getItem(TON_SCHEME_STORAGE_KEY);
  return v === TON_SCHEME_NATIVE ? TON_SCHEME_NATIVE : TON_SCHEME_LEGACY;
}
