/**
 * lib/crypto/aes.ts
 * Browser-native AES-GCM encryption for private key storage.
 * Uses PBKDF2-SHA-256 (600 000 iterations, NIST SP 800-132) to derive a 256-bit key.
 * Format: base64( salt(16) || iv(12) || ciphertext(n+16) )
 */

/**
 * Encrypt arbitrary bytes with a password.
 * Returns a base64-encoded blob that includes salt, IV and ciphertext.
 */
export async function encryptBytes(data: Uint8Array, password: string): Promise<string> {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const ct  = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data));
  const out = new Uint8Array(16 + 12 + ct.length);
  out.set(salt, 0);
  out.set(iv,   16);
  out.set(ct,   28);

  return btoa(String.fromCharCode(...out));
}

/**
 * Decrypt a blob produced by encryptBytes.
 * Throws if the password is wrong (AES-GCM authentication tag fails).
 */
export async function decryptBytes(encoded: string, password: string): Promise<Uint8Array> {
  const enc  = new TextEncoder();
  const buf  = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const salt = buf.slice(0, 16);
  const iv   = buf.slice(16, 28);
  const ct   = buf.slice(28);

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    return new Uint8Array(pt);
  } catch {
    throw new Error('Неверный пароль или повреждённые данные.');
  }
}
