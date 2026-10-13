/**
 * lib/pin.ts memory hygiene: whatever verifyPin decrypts (a v2 marker or a
 * legacy v1 wallet password) is zeroed before verifyPin returns.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ decrypted: [] as Uint8Array[] }));

vi.mock('@/lib/crypto/aes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/crypto/aes')>();
  return {
    ...real,
    decryptBytes: async (blob: string, password: string) => {
      const out = await real.decryptBytes(blob, password);
      h.decrypted.push(out);
      return out;
    },
  };
});

import { verifyPin, setupPin } from '@/lib/pin';
import { encryptBytes } from '@/lib/crypto/aes';

const SLOW = 60_000;

describe('pin — decrypted bytes are zeroed', () => {
  beforeEach(() => {
    localStorage.clear();
    h.decrypted.length = 0;
  });

  it('zeroes a legacy blob plaintext (the wallet password)', async () => {
    localStorage.setItem('wallet_pin_blob', await encryptBytes(new TextEncoder().encode('legacy-password'), '1234'));
    await verifyPin('1234');
    expect(h.decrypted.length).toBe(1);
    expect(h.decrypted[0].length).toBeGreaterThan(0);
    expect(Array.from(h.decrypted[0]).every((b) => b === 0)).toBe(true);
  }, SLOW);

  it('zeroes the v2 marker plaintext too', async () => {
    await setupPin('1234');
    await verifyPin('1234');
    expect(h.decrypted.length).toBe(1);
    expect(Array.from(h.decrypted[0]).every((b) => b === 0)).toBe(true);
  }, SLOW);
});
