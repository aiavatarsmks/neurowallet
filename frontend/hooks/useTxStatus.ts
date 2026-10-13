/**
 * hooks/useTxStatus.ts
 * Polls lib/crypto/tx-status.ts for a broadcast transfer.
 *
 * Every 5 s for up to ~3 min; exponential backoff (up to 60 s) on rate limits
 * and network errors; stops on a final state; aborts and clears timers on
 * unmount or when the hash changes. `enabled: false` (demo mode, no hash)
 * means no requests at all.
 */

import { useEffect, useState } from 'react';
import {
  getTxStatus,
  isFinalTxState,
  type TxStatus,
  type TxStatusCoin,
} from '@/lib/crypto/tx-status';

export interface UseTxStatusOptions {
  coin: TxStatusCoin;
  hash: string;
  enabled: boolean;
  /** TON / USDT-TON: the sender wallet whose seqno is polled. */
  tonWalletAddress?: string;
  intervalMs?: number;
  maxDurationMs?: number;
  maxBackoffMs?: number;
}

export interface TxStatusView extends TxStatus {
  /** A check is scheduled or running. */
  polling: boolean;
  /** Polling ended at the time limit while the state was still not final. */
  timedOut: boolean;
}

const IDLE: TxStatusView = { state: 'pending', polling: false, timedOut: false };

export const TX_STATUS_INTERVAL_MS = 5_000;
export const TX_STATUS_MAX_DURATION_MS = 3 * 60_000;
export const TX_STATUS_MAX_BACKOFF_MS = 60_000;

export function useTxStatus({
  coin,
  hash,
  enabled,
  tonWalletAddress,
  intervalMs = TX_STATUS_INTERVAL_MS,
  maxDurationMs = TX_STATUS_MAX_DURATION_MS,
  maxBackoffMs = TX_STATUS_MAX_BACKOFF_MS,
}: UseTxStatusOptions): TxStatusView {
  const [view, setView] = useState<TxStatusView>(IDLE);

  useEffect(() => {
    if (!enabled || !hash) {
      setView(IDLE);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const startedAt = Date.now();
    let failures = 0;

    setView({ state: 'pending', polling: true, timedOut: false });

    const schedule = (delay: number) => {
      if (Date.now() - startedAt + delay > maxDurationMs) {
        setView((v) => ({ ...v, polling: false, timedOut: !isFinalTxState(v.state) }));
        return;
      }
      timer = setTimeout(check, delay);
    };

    const check = async () => {
      if (cancelled) return;
      try {
        const status = await getTxStatus(coin, hash, {
          elapsedMs: Date.now() - startedAt,
          tonWalletAddress,
          signal: controller.signal,
        });
        if (cancelled) return;
        failures = 0;
        if (isFinalTxState(status.state)) {
          setView({ ...status, polling: false, timedOut: false });
          return;
        }
        setView({ ...status, polling: true, timedOut: false });
        schedule(intervalMs);
      } catch {
        if (cancelled) return;
        // 429 / 5xx / offline: keep the last state, back off exponentially.
        failures += 1;
        schedule(Math.min(intervalMs * 2 ** failures, maxBackoffMs));
      }
    };

    schedule(intervalMs);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [coin, hash, enabled, tonWalletAddress, intervalMs, maxDurationMs, maxBackoffMs]);

  return view;
}
