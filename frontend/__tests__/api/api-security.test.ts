import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit } from '@/lib/server/api-security';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxPerMinute requests, then blocks', () => {
    const key = `test:${Date.now()}:limit`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5)).toBe(true);
    }
    expect(checkRateLimit(key, 5)).toBe(false);
    expect(checkRateLimit(key, 5)).toBe(false);
  });

  it('resets the window after 60 seconds', () => {
    const key = `test:${Date.now()}:window`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    expect(checkRateLimit(key, 3)).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit(key, 3)).toBe(true);
  });

  it('tracks keys independently', () => {
    const a = `test:${Date.now()}:a`;
    const b = `test:${Date.now()}:b`;
    expect(checkRateLimit(a, 1)).toBe(true);
    expect(checkRateLimit(a, 1)).toBe(false);
    expect(checkRateLimit(b, 1)).toBe(true);
  });
});
