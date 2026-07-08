import { describe, it, expect } from 'vitest';
import { sanitizeAmountInput } from '@/lib/display-format';

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
