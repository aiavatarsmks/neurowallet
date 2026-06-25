/**
 * Client-side HD wallet generation — BIP39 + BIP44 + ethers v6.
 * Private keys and keystores never leave the browser.
 */

import * as bip39 from 'bip39';
import { ethers, encryptKeystoreJson } from 'ethers';

// ─── Base58 encoder (needed for BTC P2PKH addresses) ──────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n = n / 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

// ─── BTC P2PKH address from compressed secp256k1 public key ───────────────

function pubKeyToBTCAddress(compressedPubKey: string): string {
  // HASH160 = RIPEMD160(SHA256(pubkey))
  const sha256d = ethers.sha256(compressedPubKey);          // 32 bytes
  const hash160 = ethers.ripemd160(sha256d);               // 20 bytes, "0x"-prefixed

  // Version byte 0x00 = mainnet P2PKH
  const withVersion = '0x00' + hash160.slice(2);           // 21 bytes

  // Checksum = first 4 bytes of SHA256(SHA256(versioned))
  const chk = ethers.sha256(ethers.sha256(withVersion));
  const checksum = chk.slice(2, 10);                       // 4 bytes = 8 hex chars

  return base58Encode(ethers.getBytes(withVersion + checksum));
}

// ─── Public types ──────────────────────────────────────────────────────────

export interface GeneratedWallet {
  mnemonic: string;
  ethAddress: string;   // BIP44 m/44'/60'/0'/0/0 — also for USDT ERC-20
  btcAddress: string;   // BIP44 m/44'/0'/0'/0/0, P2PKH mainnet
  keystore: string;     // ethers encrypted JSON keystore (AES-256-CTR + scrypt)
}

// ─── Core API ─────────────────────────────────────────────────────────────

/** Generate a fresh 12-word BIP39 mnemonic (128 bits entropy). */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

/** True if phrase passes BIP39 checksum. */
export function validateMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim().toLowerCase().replace(/\s+/g, ' '));
}

/**
 * Derive HD wallet from mnemonic + encrypt keystore with password.
 * Works for both "create new" and "import existing" flows.
 *
 * scrypt N=8192 for demo speed (~1-3 s); production should use N=131072 (~20-30 s).
 */
export async function importWalletFromMnemonic(
  mnemonic: string,
  password: string,
): Promise<GeneratedWallet> {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('Неверная мнемоническая фраза. Проверь порядок и написание слов.');
  }

  // ETH / USDT ERC-20 → BIP44 m/44'/60'/0'/0/0
  const ethWallet = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/60'/0'/0/0");

  // BTC → BIP44 m/44'/0'/0'/0/0 → P2PKH mainnet address
  const btcNode = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/0'/0'/0/0");
  const btcAddress = pubKeyToBTCAddress(btcNode.publicKey);

  // Encrypt with scrypt N=8192 (fast for demo; bump to 131072 for prod)
  const keystore = await encryptKeystoreJson(
    { address: ethWallet.address, privateKey: ethWallet.privateKey },
    password,
    { scrypt: { N: 8192 } },
  );

  return {
    mnemonic: normalized,
    ethAddress: ethWallet.address,
    btcAddress,
    keystore,
  };
}

/** Decrypt a stored keystore JSON and return a live Wallet (for signing txs). */
export async function loadWalletFromKeystore(
  keystore: string,
  password: string,
): Promise<ethers.Wallet> {
  return ethers.Wallet.fromEncryptedJson(keystore, password) as Promise<ethers.Wallet>;
}

// ─── localStorage helpers (keys shared with ReceiveScreen) ────────────────

const LS = { ETH: 'wallet_eth_address', BTC: 'wallet_btc_address', KS: 'wallet_keystore' };

export function saveWalletToStorage(w: GeneratedWallet): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS.ETH, w.ethAddress);
  localStorage.setItem(LS.BTC, w.btcAddress);
  localStorage.setItem(LS.KS, w.keystore);
}

export function loadAddressesFromStorage(): { eth: string; btc: string } | null {
  if (typeof window === 'undefined') return null;
  const eth = localStorage.getItem(LS.ETH);
  const btc = localStorage.getItem(LS.BTC);
  return eth && btc ? { eth, btc } : null;
}

export function clearWalletFromStorage(): void {
  if (typeof window === 'undefined') return;
  Object.values(LS).forEach((k) => localStorage.removeItem(k));
}
