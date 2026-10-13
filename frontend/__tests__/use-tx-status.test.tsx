import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({ getTxStatus: vi.fn() }));
vi.mock('@/lib/crypto/tx-status', async (orig) => ({
  ...(await orig<typeof import('@/lib/crypto/tx-status')>()),
  getTxStatus: H.getTxStatus,
}));

import { useTxStatus } from '@/hooks/useTxStatus';
import { TxStatusFetchError } from '@/lib/crypto/tx-status';

const HASH = 'ab'.repeat(32);

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useTxStatus polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    H.getTxStatus.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('disabled (demo mode / no hash): never polls', async () => {
    const { result } = renderHook(() => useTxStatus({ coin: 'TRC20', hash: HASH, enabled: false }));
    await advance(60_000);
    expect(H.getTxStatus).not.toHaveBeenCalled();
    expect(result.current).toEqual({ state: 'pending', polling: false, timedOut: false });
  });

  it('polls every 5 s and stops on a final state', async () => {
    H.getTxStatus
      .mockResolvedValueOnce({ state: 'pending' })
      .mockResolvedValueOnce({ state: 'failed', reason: 'OUT_OF_ENERGY' });
    const { result } = renderHook(() => useTxStatus({ coin: 'TRC20', hash: HASH, enabled: true }));
    expect(result.current.polling).toBe(true);

    await advance(4_999);
    expect(H.getTxStatus).not.toHaveBeenCalled();
    await advance(1);
    expect(H.getTxStatus).toHaveBeenCalledTimes(1);
    expect(H.getTxStatus.mock.calls[0][0]).toBe('TRC20');
    expect(H.getTxStatus.mock.calls[0][1]).toBe(HASH);

    await advance(5_000);
    expect(result.current).toMatchObject({ state: 'failed', reason: 'OUT_OF_ENERGY', polling: false });

    await advance(60_000);
    expect(H.getTxStatus).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially on 429 / network errors, then resumes the normal interval', async () => {
    H.getTxStatus
      .mockRejectedValueOnce(new TxStatusFetchError(429, 'rate'))
      .mockRejectedValueOnce(new TxStatusFetchError(null, 'net'))
      .mockResolvedValueOnce({ state: 'pending' })
      .mockResolvedValue({ state: 'confirmed' });
    renderHook(() => useTxStatus({ coin: 'SOL', hash: HASH, enabled: true }));

    await advance(5_000);                       // t=5s: 1st call → 429
    expect(H.getTxStatus).toHaveBeenCalledTimes(1);
    await advance(9_999);                       // backoff 10 s
    expect(H.getTxStatus).toHaveBeenCalledTimes(1);
    await advance(1);                           // t=15s: 2nd call → network error
    expect(H.getTxStatus).toHaveBeenCalledTimes(2);
    await advance(19_999);                      // backoff 20 s
    expect(H.getTxStatus).toHaveBeenCalledTimes(2);
    await advance(1);                           // t=35s: pending → back to 5 s
    expect(H.getTxStatus).toHaveBeenCalledTimes(3);
    await advance(5_000);
    expect(H.getTxStatus).toHaveBeenCalledTimes(4);
  });

  it('passes elapsed time and the TON wallet to the status check', async () => {
    H.getTxStatus.mockResolvedValue({ state: 'pending' });
    renderHook(() => useTxStatus({ coin: 'USDT_TON', hash: 'ton:seqno:3', enabled: true, tonWalletAddress: 'EQwallet' }));
    await advance(5_000);
    const ctx = H.getTxStatus.mock.calls[0][2];
    expect(ctx.tonWalletAddress).toBe('EQwallet');
    expect(ctx.elapsedMs).toBe(5_000);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up after ~3 min with timedOut, keeping the last state', async () => {
    H.getTxStatus.mockResolvedValue({ state: 'pending' });
    const { result } = renderHook(() => useTxStatus({ coin: 'BTC', hash: HASH, enabled: true }));
    await advance(3 * 60_000 + 30_000);
    const calls = H.getTxStatus.mock.calls.length;
    expect(calls).toBe(36); // 5 s … 180 s
    expect(result.current).toMatchObject({ state: 'pending', polling: false, timedOut: true });
    await advance(60_000);
    expect(H.getTxStatus).toHaveBeenCalledTimes(calls);
  });

  it('unmount aborts the in-flight check and clears the timer', async () => {
    let signal: AbortSignal | undefined;
    H.getTxStatus.mockImplementation((_c: string, _h: string, ctx: { signal: AbortSignal }) => {
      signal = ctx.signal;
      return new Promise(() => {});
    });
    const { unmount } = renderHook(() => useTxStatus({ coin: 'ETH', hash: '0x' + HASH, enabled: true }));
    await advance(5_000);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await advance(60_000);
    expect(H.getTxStatus).toHaveBeenCalledTimes(1);
  });
});
