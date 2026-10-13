import { describe, it, expect } from 'vitest';
import { sanitizeHistory, sanitizeWalletContext } from '@/lib/server/neura-chat-input';

describe('sanitizeHistory', () => {
  it('returns [] for non-arrays', () => {
    expect(sanitizeHistory(undefined).messages).toEqual([]);
    expect(sanitizeHistory('hi').messages).toEqual([]);
    expect(sanitizeHistory({ 0: { role: 'user', content: 'x' } }).messages).toEqual([]);
  });

  it('keeps only user/assistant with string content and strips extra keys', () => {
    const { messages } = sanitizeHistory([
      { role: 'user', content: 'a', name: 'x', tool_calls: [] },
      { role: 'system', content: 'b' },
      { role: 'assistant', content: 1 },
    ]);
    expect(messages).toEqual([{ role: 'user', content: 'a' }]);
  });
});

describe('sanitizeWalletContext', () => {
  it('undefined for non-objects, arrays and when nothing survives', () => {
    expect(sanitizeWalletContext(null)).toBeUndefined();
    expect(sanitizeWalletContext('x')).toBeUndefined();
    expect(sanitizeWalletContext([1, 2])).toBeUndefined();
    expect(sanitizeWalletContext({ foo: 1, eth: 'x' })).toBeUndefined();
  });

  it('clamps numbers and drops non-finite ones', () => {
    expect(sanitizeWalletContext({ eth: -1, btc: Infinity, sol: 2, ethEur: 1e9 })).toEqual({ eth: 0, sol: 2, ethEur: 1e7 });
  });

  it('accepts well-formed per-chain addresses only', () => {
    const ok = {
      ethAddr: '0x1234567890abcdef1234567890abcdef12345678',
      btcAddr: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      solAddr: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      tronAddr: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      tonAddr: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
    };
    expect(sanitizeWalletContext(ok)).toEqual(ok);
    expect(sanitizeWalletContext({ tonAddr: '0:' + 'a'.repeat(64) })).toEqual({ tonAddr: '0:' + 'a'.repeat(64) });
    expect(sanitizeWalletContext({
      ethAddr: '0x1234', btcAddr: 'bc1 OR 1=1', solAddr: 'l'.repeat(40), tronAddr: 'T<script>', tonAddr: 'x',
    })).toBeUndefined();
  });
});
