/**
 * lib/pin.ts — PIN as a UI lock: setup/verify round-trip, the v2 verifier blob
 * (never the wallet password), migration of legacy v1 blobs that held the
 * password, wrong-PIN counter and the 5-attempt lockout.
 * Runs in jsdom for localStorage; crypto.subtle comes from the Node global.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  hasPinSetup, setupPin, verifyPin, clearPin,
  getRemainingAttempts, getLockoutMs, PIN_VERIFIER_MARKER,
} from '@/lib/pin';
import { encryptBytes, decryptBytes } from '@/lib/crypto/aes';

const PW = 'wallet-password-123';
const PIN = '1234';
const SLOW = 60_000;
const BLOB_KEY = 'wallet_pin_blob';

async function blobPlaintext(pin: string): Promise<string> {
  const blob = localStorage.getItem(BLOB_KEY);
  if (!blob) throw new Error('no blob');
  return new TextDecoder().decode(await decryptBytes(blob, pin));
}

/** A blob in the pre-v2 format: the wallet password encrypted under the PIN. */
async function writeLegacyBlob(password: string, pin: string): Promise<void> {
  localStorage.setItem(BLOB_KEY, await encryptBytes(new TextEncoder().encode(password), pin));
}

describe('pin — setup & verify', () => {
  beforeEach(() => localStorage.clear());

  it('has no PIN until set up', () => {
    expect(hasPinSetup()).toBe(false);
  });

  it('setupPin stores a verifier: the blob decrypts to the marker, never the password', async () => {
    await setupPin(PW, PIN);
    expect(hasPinSetup()).toBe(true);
    const plain = await blobPlaintext(PIN);
    expect(plain).toBe(PIN_VERIFIER_MARKER);
    expect(plain).not.toContain(PW);
  }, SLOW);

  it('the single-argument form stores the same verifier', async () => {
    await setupPin(PIN);
    expect(await blobPlaintext(PIN)).toBe(PIN_VERIFIER_MARKER);
  }, SLOW);

  it('verifyPin resolves without returning the password', async () => {
    await setupPin(PW, PIN);
    await expect(verifyPin(PIN)).resolves.toBeUndefined();
  }, SLOW);

  it('clearPin removes the blob and blocks verify', async () => {
    await setupPin(PW, PIN);
    clearPin();
    expect(hasPinSetup()).toBe(false);
    await expect(verifyPin(PIN)).rejects.toThrow(/PIN/);
  }, SLOW);
});

describe('pin — legacy v1 blob (password under the PIN)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('unlocks with the right PIN and is migrated to a verifier immediately', async () => {
    await writeLegacyBlob(PW, PIN);
    const before = localStorage.getItem(BLOB_KEY);

    await expect(verifyPin(PIN)).resolves.toBeUndefined();

    const after = localStorage.getItem(BLOB_KEY);
    expect(after).not.toBe(before);
    expect(await blobPlaintext(PIN)).toBe(PIN_VERIFIER_MARKER);
    // Still unlocks after the migration.
    await expect(verifyPin(PIN)).resolves.toBeUndefined();
  }, SLOW);

  it('a wrong PIN against a legacy blob counts as a normal wrong attempt and does not migrate', async () => {
    await writeLegacyBlob(PW, PIN);
    const before = localStorage.getItem(BLOB_KEY);
    await expect(verifyPin('0000')).rejects.toThrow(/WRONG:4/);
    expect(localStorage.getItem(BLOB_KEY)).toBe(before);
    expect(getRemainingAttempts()).toBe(4);
  }, SLOW);

  it('unlock still succeeds when the migration write throws', async () => {
    await writeLegacyBlob(PW, PIN);
    const before = localStorage.getItem(BLOB_KEY);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === BLOB_KEY) throw new Error('QuotaExceededError');
      return original.call(this, k, v);
    });

    await expect(verifyPin(PIN)).resolves.toBeUndefined();
    expect(localStorage.getItem(BLOB_KEY)).toBe(before); // retried on the next unlock
  }, SLOW);
});

describe('pin — wrong-PIN counter & lockout', () => {
  beforeEach(() => localStorage.clear());

  it('decrements remaining attempts on a wrong PIN', async () => {
    await setupPin(PW, PIN);
    expect(getRemainingAttempts()).toBe(5);
    await expect(verifyPin('0000')).rejects.toThrow(/WRONG:4/);
    expect(getRemainingAttempts()).toBe(4);
  }, SLOW);

  it('locks out after 5 wrong attempts, even for the correct PIN', async () => {
    await setupPin(PW, PIN);
    for (let i = 0; i < 5; i++) {
      await expect(verifyPin('0000')).rejects.toThrow(/WRONG|LOCKED/);
    }
    expect(getLockoutMs()).toBeGreaterThan(0);
    // Correct PIN is refused while locked out.
    await expect(verifyPin(PIN)).rejects.toThrow(/LOCKED/);
  }, SLOW);

  it('a successful verify resets the attempt counter', async () => {
    await setupPin(PW, PIN);
    await expect(verifyPin('0000')).rejects.toThrow();
    expect(getRemainingAttempts()).toBe(4);
    await verifyPin(PIN); // correct
    expect(getRemainingAttempts()).toBe(5);
  }, SLOW);

  it('setting a new PIN clears an active lockout', async () => {
    await setupPin(PW, PIN);
    for (let i = 0; i < 5; i++) {
      await expect(verifyPin('0000')).rejects.toThrow(/WRONG|LOCKED/);
    }
    expect(getLockoutMs()).toBeGreaterThan(0);
    await setupPin('5678'); // "Forgot PIN?" after the wallet password was checked
    expect(getLockoutMs()).toBe(0);
    expect(getRemainingAttempts()).toBe(5);
    await expect(verifyPin('5678')).resolves.toBeUndefined();
  }, SLOW);
});
