// @vitest-environment node
/**
 * lib/crypto/aes.ts — AES-GCM + PBKDF2 round-trip and tamper/auth tests.
 * These guard the primitive that protects every non-ETH private key at rest.
 */
import { describe, it, expect } from 'vitest';
import { encryptBytes, decryptBytes } from '@/lib/crypto/aes';

const bytes = (s: string) => new TextEncoder().encode(s);
const SLOW = 60_000;

describe('aes — encrypt/decrypt round-trip', () => {
  it('decrypts back to the exact plaintext with the right password', async () => {
    const data = bytes('super-secret-key-material-32bytes');
    const blob = await encryptBytes(data, 'pw-correct');
    const out = await decryptBytes(blob, 'pw-correct');
    expect(new TextDecoder().decode(out)).toBe('super-secret-key-material-32bytes');
  }, SLOW);

  it('rejects a wrong password (GCM auth tag fails)', async () => {
    const blob = await encryptBytes(bytes('x'.repeat(32)), 'pw-correct');
    await expect(decryptBytes(blob, 'pw-wrong')).rejects.toThrow();
  }, SLOW);
});

describe('aes — integrity + uniqueness', () => {
  it('rejects a tampered ciphertext', async () => {
    const blob = await encryptBytes(bytes('hello world'), 'pw');
    // Flip a byte in the middle of the base64 blob → corrupt ciphertext/tag.
    const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    raw[raw.length - 1] ^= 0xff; // corrupt the last byte (inside GCM tag)
    const tampered = btoa(String.fromCharCode(...raw));
    await expect(decryptBytes(tampered, 'pw')).rejects.toThrow();
  }, SLOW);

  it('uses a fresh salt+iv each time (same input → different blob)', async () => {
    const data = bytes('same-input');
    const a = await encryptBytes(data, 'pw');
    const b = await encryptBytes(data, 'pw');
    expect(a).not.toBe(b);
    // Both still decrypt correctly.
    expect(new TextDecoder().decode(await decryptBytes(a, 'pw'))).toBe('same-input');
    expect(new TextDecoder().decode(await decryptBytes(b, 'pw'))).toBe('same-input');
  }, SLOW);

  it('blob carries at least salt(16)+iv(12)+tag(16) bytes', async () => {
    const blob = await encryptBytes(bytes(''), 'pw');
    const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    expect(raw.length).toBeGreaterThanOrEqual(16 + 12 + 16);
  }, SLOW);
});
