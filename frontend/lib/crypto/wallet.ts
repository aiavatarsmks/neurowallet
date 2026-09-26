/**
 * lib/crypto/wallet.ts
 * BIP39 + BIP44 HD wallet for ETH (EVM) and Solana.
 * All operations are client-side only — call inside useEffect or event handlers.
 */

import * as bip39 from 'bip39';
import { ethers, encryptKeystoreJson } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { derivePath } from 'ed25519-hd-key';
import { tronAddressFromPrivKey } from './tron-tx';
import { tonAddressFromPrivKey } from './ton-tx';
import { btcSegwitAddressFromPrivKey } from './btc-tx';
import { encryptBytes } from './aes';
import { generateDualValidMnemonic, tonSchemeForPhrase, tonSeedFromMnemonic } from './ton-mnemonic';
import {
  tonMnemonicEnabled,
  TON_SCHEME_NATIVE,
  TON_SCHEME_STORAGE_KEY,
  type TonScheme,
} from '@/lib/ton-mnemonic-config';

export interface CryptoWallet {
  eth:  string;       // Ethereum address (BIP44 m/44'/60'/0'/0/0)
  sol:  string;       // Solana address (Ed25519 pubkey, Base58)
  btc:  string;       // Bitcoin native SegWit address (BIP84-compatible bc1q...)
  tron: string;       // Tron address (BIP44 m/44'/195'/0'/0/0, T...)
  ton:  string;       // TON V4R2 address (scheme: see tonScheme)
  tonScheme: TonScheme; // 'ton-mnemonic-v4r2' (24-word, Tonkeeper) | 'slip10-607-0-0' (legacy)
  mnemonic: string;   // BIP39 phrase: 12 words (legacy) or 24 words (dual-valid BIP39 + TON)
  keystore: string;   // Encrypted ETH keystore JSON (AES-256 + scrypt N=131072)
  solEnc:  string;    // SOL privkey encrypted with AES-GCM + PBKDF2 (base64)
  btcEnc:  string;    // BTC privkey encrypted with AES-GCM + PBKDF2 (base64)
  tronEnc: string;    // TRX privkey encrypted with AES-GCM + PBKDF2 (base64)
  tonEnc:  string;    // TON privkey encrypted with AES-GCM + PBKDF2 (base64)
}

// ─── Core wallet generation ────────────────────────────────────────────────

export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

/**
 * Phrase for a NEW wallet. Flag ON: 24 words valid both as BIP39 and as a TON
 * mnemonic (one phrase restores TON in Tonkeeper and EVM/SOL/BTC/TRON in their
 * wallets). Flag OFF: the previous 12-word BIP39 phrase.
 */
export async function generateNewWalletMnemonic(): Promise<string> {
  return tonMnemonicEnabled() ? generateDualValidMnemonic() : generateMnemonic();
}

export function validateMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim().toLowerCase().replace(/\s+/g, ' '));
}

export async function importWalletFromMnemonic(
  mnemonic: string,
  password: string,
): Promise<CryptoWallet> {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  const wordCount = normalized.split(' ').length;
  if ((wordCount !== 12 && wordCount !== 24) || !bip39.validateMnemonic(normalized)) {
    throw new Error('Неверная мнемоническая фраза. Проверь порядок и написание слов.');
  }

  // ETH — BIP44 m/44'/60'/0'/0/0
  const ethWallet = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/60'/0'/0/0");

  // BTC — m/84'/0'/0'/0/0 private key → native SegWit P2WPKH (bc1q...)
  // ethers derives the key material; bitcoinjs-lib builds the actual address.
  const btcNode = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/84'/0'/0'/0/0");

  // SOL — SLIP-0010 ed25519 at m/44'/501'/0'/0' (Phantom/Solflare standard)
  const seed = await bip39.mnemonicToSeed(normalized);
  const { key: solPrivKey } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
  const solPubKey = ed25519.getPublicKey(solPrivKey);
  const sol = bs58.encode(solPubKey);

  // Encrypt ETH private key — scrypt N=131072 (2^17, ~3-8 s; OWASP minimum for sensitive keys)
  const keystore = await encryptKeystoreJson(
    { address: ethWallet.address, privateKey: ethWallet.privateKey },
    password,
    { scrypt: { N: 131072 } },
  );

  // Encrypt each chain's private key independently with AES-GCM + PBKDF2.
  // Each chain has its own ciphertext — compromising one key does NOT expose others.
  const solPrivBytes  = solPrivKey as unknown as Uint8Array;
  const btcPrivBytes  = ethers.getBytes(btcNode.privateKey);
  const btc           = btcSegwitAddressFromPrivKey(btcPrivBytes);

  const solEnc  = await encryptBytes(solPrivBytes,  password);
  const btcEnc  = await encryptBytes(btcPrivBytes,  password);

  // TRX — BIP44 m/44'/195'/0'/0/0 (secp256k1, same curve as ETH/BTC)
  const tronNode      = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/195'/0'/0/0");
  const tronPrivBytes = ethers.getBytes(tronNode.privateKey);
  const tron          = tronAddressFromPrivKey(tronPrivBytes);
  const tronEnc       = await encryptBytes(tronPrivBytes, password);

  // TON — scheme is decided by the phrase itself (never by a feature flag, so a
  // re-import always yields the same address):
  //  • 24 words that are a valid TON mnemonic → TON standard (Tonkeeper-compatible);
  //  • otherwise (all 12-word phrases) → legacy SLIP-0010 ed25519 at
  //    m/44'/607'/0'/0' (all components hardened — required by ed25519-hd-key).
  const tonScheme = await tonSchemeForPhrase(normalized);
  const tonPrivBytes: Uint8Array = tonScheme === TON_SCHEME_NATIVE
    ? await tonSeedFromMnemonic(normalized)
    : (derivePath("m/44'/607'/0'/0'", seed.toString('hex')).key as unknown as Uint8Array);
  // Flag ON → store/show the non-bounceable UQ… form (same account as EQ…).
  const ton    = tonAddressFromPrivKey(tonPrivBytes, { bounceable: !tonMnemonicEnabled() });
  const tonEnc = await encryptBytes(tonPrivBytes, password);

  // Zero out all in-memory private key buffers before returning
  solPrivBytes.fill(0);
  btcPrivBytes.fill(0);
  tronPrivBytes.fill(0);
  tonPrivBytes.fill(0);

  return { eth: ethWallet.address, sol, btc, tron, ton, tonScheme, mnemonic: normalized, keystore, solEnc, btcEnc, tronEnc, tonEnc };
}

// ─── localStorage helpers ──────────────────────────────────────────────────

const LS = {
  ETH:      'wallet_eth_address',
  SOL:      'wallet_sol_address',
  BTC:      'wallet_btc_address',
  TRON:     'wallet_tron_address',
  TON:      'wallet_ton_address',
  KS:       'wallet_keystore',
  SOL_ENC:  'wallet_sol_enc',
  BTC_ENC:  'wallet_btc_enc',
  TRON_ENC: 'wallet_tron_enc',
  TON_ENC:  'wallet_ton_enc',
  TON_SCHEME: TON_SCHEME_STORAGE_KEY,
};

export function saveWalletToStorage(w: CryptoWallet): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS.ETH,      w.eth);
  localStorage.setItem(LS.SOL,      w.sol);
  localStorage.setItem(LS.BTC,      w.btc);
  localStorage.setItem(LS.TRON,     w.tron);
  localStorage.setItem(LS.TON,      w.ton);
  localStorage.setItem(LS.KS,       w.keystore);
  localStorage.setItem(LS.SOL_ENC,  w.solEnc);
  localStorage.setItem(LS.BTC_ENC,  w.btcEnc);
  localStorage.setItem(LS.TRON_ENC, w.tronEnc);
  localStorage.setItem(LS.TON_ENC,  w.tonEnc);
  localStorage.setItem(LS.TON_SCHEME, w.tonScheme);
}

export function loadAddressesFromStorage(): { eth: string; sol: string; btc: string; tron: string; ton: string } | null {
  if (typeof window === 'undefined') return null;
  const eth  = localStorage.getItem(LS.ETH);
  const sol  = localStorage.getItem(LS.SOL);
  const btc  = localStorage.getItem(LS.BTC);
  const tron = localStorage.getItem(LS.TRON);
  const ton  = localStorage.getItem(LS.TON);
  return eth ? { eth, sol: sol ?? '', btc: btc ?? '', tron: tron ?? '', ton: ton ?? '' } : null;
}

export function hasWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(LS.ETH);
}

export function clearWalletFromStorage(): void {
  if (typeof window === 'undefined') return;
  Object.values(LS).forEach((k) => localStorage.removeItem(k));
  clearLegacyXorKeys();
}

// Legacy XOR-scheme blobs (scheme removed in commit 4b3704e). No code reads
// them anymore; test wallets from that era must re-import from mnemonic.
// Purged on every app start so stale key-derived material doesn't linger
// in localStorage.
const LEGACY_XOR_KEYS = ['wallet_sol_xor', 'wallet_btc_xor', 'wallet_tron_xor', 'wallet_ton_xor'];

export function clearLegacyXorKeys(): void {
  if (typeof window === 'undefined') return;
  LEGACY_XOR_KEYS.forEach((k) => localStorage.removeItem(k));
}
