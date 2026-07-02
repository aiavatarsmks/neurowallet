import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, checkRateLimitMemory } from '@/lib/server/api-security';

// Без UPSTASH_REDIS_REST_URL/TOKEN в env durable-путь недоступен и
// checkRateLimit обязан прозрачно работать через in-memory fallback.

describe('checkRateLimit (async, in-memory fallback path)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxPerMinute requests, then blocks', async () => {
    const key = `test:${Date.now()}:limit`;
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit(key, 5)).toBe(true);
    }
    expect(await checkRateLimit(key, 5)).toBe(false);
    expect(await checkRateLimit(key, 5)).toBe(false);
  });

  it('resets the window after 60 seconds', async () => {
    const key = `test:${Date.now()}:window`;
    for (let i = 0; i < 3; i++) await checkRateLimit(key, 3);
    expect(await checkRateLimit(key, 3)).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(await checkRateLimit(key, 3)).toBe(true);
  });

  it('tracks keys independently', async () => {
    const a = `test:${Date.now()}:a`;
    const b = `test:${Date.now()}:b`;
    expect(await checkRateLimit(a, 1)).toBe(true);
    expect(await checkRateLimit(a, 1)).toBe(false);
    expect(await checkRateLimit(b, 1)).toBe(true);
  });

  it('memory limiter is exported directly for fallback semantics', () => {
    const key = `test:${Date.now()}:mem`;
    expect(checkRateLimitMemory(key, 1)).toBe(true);
    expect(checkRateLimitMemory(key, 1)).toBe(false);
  });
});
