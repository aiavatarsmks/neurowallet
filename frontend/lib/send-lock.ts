/**
 * lib/send-lock.ts: one transfer at a time, app-wide.
 *
 * CryptoSendScreen's own re-entrancy guard is a useRef, so it lives and dies
 * with one mounted instance. pages/wallet.tsx mounts the screen only while the
 * 'crypto-send' tab is open: a user who confirmed a send and then left the tab
 * during the multi-second decrypt + broadcast got a fresh instance (guard
 * reset) on return, while the first send finished unseen in the unmounted
 * one. Sending again then made a second, real transfer.
 *
 * This lock is module state, shared by every instance:
 *  - the send handler acquires it synchronously, before its first await, and
 *    releases it in `finally`; a second instance cannot start while it is held;
 *  - the wallet shell subscribes (useSendLocked) and disables every way off
 *    the screen while a send is in flight.
 *
 * A page reload clears it, which is fine: the reload also ends the send.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

let locked = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* a listener must never break the send path */ }
  }
}

export const sendLock = {
  /** Take the lock. Returns false (and changes nothing) when a send already holds it. */
  acquire(): boolean {
    if (locked) return false;
    locked = true;
    emit();
    return true;
  },
  /** Release the lock. Only the caller whose acquire() returned true may call this. */
  release(): void {
    if (!locked) return;
    locked = false;
    emit();
  },
  isLocked(): boolean {
    return locked;
  },
  /** Called on every lock/unlock. Returns the unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/**
 * Test hook: drop a lock left held by a test whose send never settled (the
 * module outlives the test case). Never called by app code.
 */
export function resetSendLockForTests(): void {
  sendLock.release();
}

const getServerSnapshot = () => false;

/** True while a transfer is being signed / broadcast anywhere in the app. */
export function useSendLocked(): boolean {
  return useSyncExternalStore(sendLock.subscribe, sendLock.isLocked, getServerSnapshot);
}
