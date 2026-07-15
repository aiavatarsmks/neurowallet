/**
 * lib/pin.ts — PIN convenience-unlock: setup/verify round-trip, wrong-PIN
 * counter, and the 5-attempt lockout (a real security control per CLAUDE.md).
 * Runs in jsdom for localStorage; crypto.subtle comes from the Node global.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasPinSetup, setupPin, verifyPin, clearPin,
  getRemainingAttempts, getLockoutMs,
} from '@/lib/pin';

const PW = 'wallet-password-123';
const PIN = '1234';
const SLOW = 60_000;

describe('pin — setup & verify', () => {
  beforeEach(() => localStorage.clear());

  it('has no PIN until set up', () => {
    expect(hasPinSetup()).toBe(false);
  });

  it('round-trips the wallet password through the PIN envelope', async () => {
    await setupPin(PW, PIN);
    expect(hasPinSetup()).toBe(true);
    expect(await verifyPin(PIN)).toBe(PW);
  }, SLOW);

  it('clearPin removes the blob and blocks verify', async () => {
    await setupPin(PW, PIN);
    clearPin();
    expect(hasPinSetup()).toBe(false);
    await expect(verifyPin(PIN)).rejects.toThrow(/PIN/);
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
});
