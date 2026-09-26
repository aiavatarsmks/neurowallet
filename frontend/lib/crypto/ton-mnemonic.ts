/**
 * lib/crypto/ton-mnemonic.ts
 * Tonkeeper-compatible TON keys from a phrase that is ALSO a valid BIP39
 * mnemonic (DECISION_TON_DERIVATION.md).
 *
 * TON standard (@ton/crypto — the reference implementation used by Tonkeeper):
 *   entropy = HMAC-SHA512(key = words.join(' '), data = '')
 *   valid   ⇔ PBKDF2-SHA512(entropy, 'TON seed version', 390)[0] === 0
 *   seed    = PBKDF2-SHA512(entropy, 'TON default seed', 100 000)[0..32] → ed25519
 * No derivation path. Contract: WalletContractV4 (V4R2), workchain 0.
 *
 * Client-only key material: the 32-byte seed is returned to the caller, who
 * encrypts it and zeroes it. Nothing here touches storage or the network.
 */
import * as bip39 from 'bip39';
import { mnemonicValidate, mnemonicToPrivateKey } from '@ton/crypto';
import { TON_SCHEME_LEGACY, TON_SCHEME_NATIVE, type TonScheme } from '@/lib/ton-mnemonic-config';

export const TON_MNEMONIC_WORDS = 24;
const MAX_ATTEMPTS = 20_000; // expected ~256; bound keeps a broken RNG/lib from hanging the UI

function toWords(phrase: string): string[] {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True if the phrase is a valid TON mnemonic (24 words, no password). */
export async function isTonMnemonic(phrase: string): Promise<boolean> {
  const words = toWords(phrase);
  if (words.length !== TON_MNEMONIC_WORDS) return false;
  try {
    return await mnemonicValidate(words);
  } catch {
    return false;
  }
}

/**
 * 24 words valid BOTH as BIP39 (checksum — MetaMask/Phantom accept it) and as a
 * TON mnemonic (Tonkeeper accepts it). Rejection sampling over BIP39 phrases;
 * ~1/256 pass the TON check, each check is one HMAC + 390-iteration PBKDF2.
 */
export async function generateDualValidMnemonic(): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const phrase = bip39.generateMnemonic(256);
    if (await mnemonicValidate(phrase.split(' '))) return phrase;
  }
  throw new Error('Не удалось сгенерировать фразу. Попробуй ещё раз.');
}

/** Scheme a phrase imports under — decided by the phrase, never by a flag. */
export async function tonSchemeForPhrase(phrase: string): Promise<TonScheme> {
  return (await isTonMnemonic(phrase)) ? TON_SCHEME_NATIVE : TON_SCHEME_LEGACY;
}

/**
 * 32-byte ed25519 seed per the TON standard (== keyPairFromSeed input used by
 * ton-tx.ts for signing). Caller must zero it after use.
 */
export async function tonSeedFromMnemonic(phrase: string): Promise<Uint8Array> {
  const words = toWords(phrase);
  const keyPair = await mnemonicToPrivateKey(words);
  // tweetnacl secretKey = seed(32) || publicKey(32)
  const seed = new Uint8Array(keyPair.secretKey.subarray(0, 32));
  keyPair.secretKey.fill(0);
  return seed;
}
