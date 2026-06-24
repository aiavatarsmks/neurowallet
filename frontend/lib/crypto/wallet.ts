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

export interface CryptoWallet {
  eth:  string;       // Ethereum address (BIP44 m/44'/60'/0'/0/0)
  sol:  string;       // Solana address (Ed25519 pubkey, Base58)
  btc:  string;       // Bitcoin P2PKH address (BIP44 m/44'/0'/0'/0/0)
  tron: string;       // Tron address (BIP44 m/44'/195'/0'/0/0, T...)
  mnemonic: string;   // 12-word BIP39 phrase
  keystore: string;   // Encrypted ETH keystore JSON (AES-256 + scrypt)
  solXor:  string;    // SOL privkey XOR ETH privkey (hex)
  btcXor:  string;    // BTC privkey XOR ETH privkey (hex)
  tronXor: string;    // TRX privkey XOR ETH privkey (hex)
}

// ─── Base58 (used for BTC P2PKH checksum address) ─────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58CheckEncode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n = n / 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

function pubKeyToBTCAddress(compressedPubKey: string): string {
  const sha256d = ethers.sha256(compressedPubKey);
  const hash160 = ethers.ripemd160(sha256d);
  const withVersion = '0x00' + hash160.slice(2);
  const chk = ethers.sha256(ethers.sha256(withVersion));
  return base58CheckEncode(ethers.getBytes(withVersion + chk.slice(2, 10)));
}

// ─── Core wallet generation ────────────────────────────────────────────────

export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

export function validateMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim().toLowerCase().replace(/\s+/g, ' '));
}

export async function importWalletFromMnemonic(
  mnemonic: string,
  password: string,
): Promise<CryptoWallet> {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('Неверная мнемоническая фраза. Проверь порядок и написание слов.');
  }

  // ETH — BIP44 m/44'/60'/0'/0/0
  const ethWallet = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/60'/0'/0/0");

  // BTC — BIP44 m/44'/0'/0'/0/0 → P2PKH
  const btcNode = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/0'/0'/0/0");
  const btc = pubKeyToBTCAddress(btcNode.publicKey);

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

  // Store SOL and BTC private keys as XOR with ETH private key.
  // Neither key is recoverable from the XOR blob alone — password required to unlock ETH key first.
  const ethPrivBytes = ethers.getBytes(ethWallet.privateKey); // Uint8Array(32)

  const solXorArr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    solXorArr[i] = (solPrivKey as unknown as Uint8Array)[i] ^ ethPrivBytes[i];
  }
  const solXor = Array.from(solXorArr).map((b) => b.toString(16).padStart(2, '0')).join('');

  const btcPrivBytes = ethers.getBytes(btcNode.privateKey); // Uint8Array(32)
  const btcXorArr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    btcXorArr[i] = btcPrivBytes[i] ^ ethPrivBytes[i];
  }
  const btcXor = Array.from(btcXorArr).map((b) => b.toString(16).padStart(2, '0')).join('');

  // TRX — BIP44 m/44'/195'/0'/0/0 (secp256k1, same curve as ETH/BTC)
  const tronNode     = ethers.HDNodeWallet.fromPhrase(normalized, '', "m/44'/195'/0'/0/0");
  const tronPrivBytes = ethers.getBytes(tronNode.privateKey);
  const tron = tronAddressFromPrivKey(tronPrivBytes);
  const tronXorArr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    tronXorArr[i] = tronPrivBytes[i] ^ ethPrivBytes[i];
  }
  const tronXor = Array.from(tronXorArr).map((b) => b.toString(16).padStart(2, '0')).join('');

  return { eth: ethWallet.address, sol, btc, tron, mnemonic: normalized, keystore, solXor, btcXor, tronXor };
}

// ─── localStorage helpers ──────────────────────────────────────────────────

const LS = {
  ETH:      'wallet_eth_address',
  SOL:      'wallet_sol_address',
  BTC:      'wallet_btc_address',
  TRON:     'wallet_tron_address',
  KS:       'wallet_keystore',
  SOL_XOR:  'wallet_sol_xor',
  BTC_XOR:  'wallet_btc_xor',
  TRON_XOR: 'wallet_tron_xor',
};

export function saveWalletToStorage(w: CryptoWallet): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS.ETH,      w.eth);
  localStorage.setItem(LS.SOL,      w.sol);
  localStorage.setItem(LS.BTC,      w.btc);
  localStorage.setItem(LS.TRON,     w.tron);
  localStorage.setItem(LS.KS,       w.keystore);
  localStorage.setItem(LS.SOL_XOR,  w.solXor);
  localStorage.setItem(LS.BTC_XOR,  w.btcXor);
  localStorage.setItem(LS.TRON_XOR, w.tronXor);
}

export function loadAddressesFromStorage(): { eth: string; sol: string; btc: string; tron: string } | null {
  if (typeof window === 'undefined') return null;
  const eth  = localStorage.getItem(LS.ETH);
  const sol  = localStorage.getItem(LS.SOL);
  const btc  = localStorage.getItem(LS.BTC);
  const tron = localStorage.getItem(LS.TRON);
  return eth ? { eth, sol: sol ?? '', btc: btc ?? '', tron: tron ?? '' } : null;
}

export function hasWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(LS.ETH);
}

export function clearWalletFromStorage(): void {
  if (typeof window === 'undefined') return;
  Object.values(LS).forEach((k) => localStorage.removeItem(k));
}
