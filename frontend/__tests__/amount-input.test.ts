import { describe, it, expect } from 'vitest';
import { sanitizeAmountInput, amountToDecimalString, COIN_DECIMALS } from '@/lib/display-format';

describe('sanitizeAmountInput', () => {
  it('keeps digits and a single decimal point', () => {
    expect(sanitizeAmountInput('0.042')).toBe('0.042');
    expect(sanitizeAmountInput('123')).toBe('123');
  });
  it('converts a comma (RU keyboard) to a dot', () => {
    expect(sanitizeAmountInput('0,5')).toBe('0.5');
  });
  it('strips letters, e-notation and signs', () => {
    expect(sanitizeAmountInput('1e5')).toBe('15');
    expect(sanitizeAmountInput('-1.2')).toBe('1.2');
    expect(sanitizeAmountInput('12abc')).toBe('12');
  });
  it('collapses multiple decimal points to the first', () => {
    expect(sanitizeAmountInput('1.2.3')).toBe('1.23');
    expect(sanitizeAmountInput('0.0.0')).toBe('0.00');
  });
  it('allows a leading dot and empty', () => {
    expect(sanitizeAmountInput('.5')).toBe('.5');
    expect(sanitizeAmountInput('')).toBe('');
  });
});

describe('sanitizeAmountInput — per-coin decimals cap', () => {
  it('truncates fractional digits beyond chain precision', () => {
    expect(sanitizeAmountInput('1.1234567', COIN_DECIMALS.USDT)).toBe('1.123456');
    expect(sanitizeAmountInput('0.123456789', COIN_DECIMALS.BTC)).toBe('0.12345678');
    expect(sanitizeAmountInput('5.', COIN_DECIMALS.TON)).toBe('5.');
  });
});

describe('amountToDecimalString', () => {
  it('never produces exponent notation (ethers/toNano reject 1e-7)', () => {
    expect(amountToDecimalString(1e-7, 18)).toBe('0.0000001');
    expect(amountToDecimalString(0.1, 18)).toBe('0.1');
  });
  it('truncates to chain decimals instead of rounding up', () => {
    expect(amountToDecimalString(1.2345678, 6)).toBe('1.234567');
    expect(amountToDecimalString(5e-10, 9)).toBe('0');
  });
  it('rejects invalid amounts', () => {
    expect(() => amountToDecimalString(NaN, 6)).toThrow();
    expect(() => amountToDecimalString(-1, 6)).toThrow();
  });
});
