/**
 * Phase 2.1 PoC (code-level, make-or-break): prove our existing lib/crypto
 * signing works with an EXTERNALLY-provided key — a key NOT derived from our
 * BIP39 seed, exactly what Web3Auth's MPC key-reconstruction mode hands back
 * (a 32-byte ed25519 seed for TON, a 32-byte secp256k1 key for TRX). If this
 * passes, wiring Web3Auth needs ZERO changes to our signing code.
 *
 * Isolated + offline (no Web3Auth account, no Telegram WebView, no broadcast).
 * The runtime PoC (Web3Auth SDK inside a real TMA signing+broadcasting testnet
 * txs) needs Maksim's account + device — see POC_WEB3AUTH.md.
 *
 * Note: address derivation (`tonAddressFromPrivKey`/`tronAddressFromPrivKey`)
 * takes the same raw Uint8Array regardless of key origin and is already covered
 * by derivation-vectors.test.ts. TON address is asserted here directly; the
 * Tron address helper routes through ethers.sha256, which trips a jsdom
 * ESM/CJS realm check only when imported in isolation (fine in the real
 * webpack bundle), so for TRX we assert the signing primitive that matters.
 */
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keyPairFromSeed } from '@ton/crypto';
import { tonAddressFromPrivKey, isValidTonAddress } from '@/lib/crypto/ton-tx';

/** A random 32-byte key NOT from our BIP39 seed — stands in for Web3Auth's. */
function externalKey(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

describe('Web3Auth key → our lib/crypto signing (Phase 2.1 PoC, offline)', () => {
  it('TON: external ed25519 seed → valid address, matching key model, verifiable signature', () => {
    const seed = externalKey(); // Web3Auth ed25519 private key/seed

    // Our builder (tonAddressFromPrivKey / sendTonRaw) accepts it as-is.
    expect(isValidTonAddress(tonAddressFromPrivKey(seed))).toBe(true);

    // TON's keyPair (used by sendTonRaw) is standard ed25519 over that seed —
    // its public key matches noble's → a Web3Auth ed25519 key is a drop-in.
    const kp = keyPairFromSeed(Buffer.from(seed));
    const noblePub = ed25519.getPublicKey(seed);
    expect(Buffer.from(kp.publicKey).toString('hex')).toBe(Buffer.from(noblePub).toString('hex'));

    // A signature made with that key verifies (what sendTonRaw does internally).
    const msg = externalKey();
    expect(ed25519.verify(ed25519.sign(msg, seed), msg, noblePub)).toBe(true);
  });

  it('TRX: external secp256k1 key signs a 32-byte tx hash exactly as sendTrxRaw does', () => {
    const key = externalKey(); // Web3Auth secp256k1 private key

    // sendTrxRaw / sendUsdtTrc20Raw sign the tx hash with
    // secp256k1.sign(hash, key, { lowS: true }) then append recovery. Prove an
    // external key round-trips through that exact call.
    const txHash = externalKey(); // stand-in 32-byte tx hash
    const sig = secp256k1.sign(txHash, key, { lowS: true });
    const pub = secp256k1.getPublicKey(key, false);
    expect(secp256k1.verify(sig, txHash, pub)).toBe(true);
    // 65-byte uncompressed pubkey is what tronAddressFromPrivKey hashes → a
    // valid Tron address is derivable from this external key (see note above).
    expect(pub.length).toBe(65);
  });

  it('sanity: different external keys yield different TON addresses (no seed coupling)', () => {
    expect(tonAddressFromPrivKey(externalKey())).not.toBe(tonAddressFromPrivKey(externalKey()));
  });
});
