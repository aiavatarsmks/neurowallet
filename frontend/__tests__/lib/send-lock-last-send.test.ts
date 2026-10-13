import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendLock, resetSendLockForTests } from '@/lib/send-lock';
import {
  LAST_SEND_STORAGE_KEY,
  LAST_SEND_MAX_AGE_MS,
  recordLastSend,
  readLastSend,
  dismissLastSend,
  shortRecipient,
} from '@/lib/last-send';

describe('sendLock (app-wide, one transfer at a time)', () => {
  beforeEach(() => resetSendLockForTests());

  it('a second acquire fails until the holder releases', () => {
    expect(sendLock.isLocked()).toBe(false);
    expect(sendLock.acquire()).toBe(true);
    expect(sendLock.acquire()).toBe(false);
    expect(sendLock.isLocked()).toBe(true);
    sendLock.release();
    expect(sendLock.isLocked()).toBe(false);
    expect(sendLock.acquire()).toBe(true);
  });

  it('notifies subscribers on lock and unlock only, and unsubscribes', () => {
    const fn = vi.fn();
    const off = sendLock.subscribe(fn);
    sendLock.acquire();
    sendLock.acquire(); // refused: no change, no event
    sendLock.release();
    sendLock.release(); // already free: no event
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    sendLock.acquire();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a throwing subscriber never breaks acquire/release', () => {
    const off = sendLock.subscribe(() => { throw new Error('boom'); });
    expect(() => sendLock.acquire()).not.toThrow();
    expect(() => sendLock.release()).not.toThrow();
    off();
  });
});

describe('last send record (nw_last_send_v1)', () => {
  const NOW = 1_800_000_000_000;
  beforeEach(() => localStorage.clear());

  it('stores coin, hash, time, amount and the recipient in short form only', () => {
    const full = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
    recordLastSend({ coin: 'SOL', hash: '5sig', amount: '0.01', to: full }, NOW);
    const raw = localStorage.getItem(LAST_SEND_STORAGE_KEY)!;
    expect(JSON.parse(raw)).toEqual({ coin: 'SOL', hash: '5sig', at: NOW, amount: '0.01', to: '9WzD…AWWM' });
    expect(raw).not.toContain(full);
    expect(readLastSend(NOW + 1000)).toMatchObject({ coin: 'SOL', hash: '5sig', to: '9WzD…AWWM' });
  });

  it('expires after 30 minutes and removes the entry', () => {
    recordLastSend({ coin: 'TRX', hash: 'h', amount: '1', to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' }, NOW);
    expect(readLastSend(NOW + LAST_SEND_MAX_AGE_MS - 1)).not.toBeNull();
    expect(readLastSend(NOW + LAST_SEND_MAX_AGE_MS)).toBeNull();
    expect(localStorage.getItem(LAST_SEND_STORAGE_KEY)).toBeNull();
  });

  it('dismiss forgets the transfer', () => {
    recordLastSend({ coin: 'ETH', hash: '0xabc', amount: '0.5', to: '0x' + '1'.repeat(40) }, NOW);
    dismissLastSend();
    expect(readLastSend(NOW)).toBeNull();
  });

  it('malformed or tampered entries are ignored and dropped', () => {
    for (const bad of [
      '{not json',
      JSON.stringify({ coin: 'DOGE', hash: 'h', at: NOW, amount: '1', to: 'x' }),
      JSON.stringify({ coin: 'ETH', hash: 'h', at: NOW, amount: '1e-7', to: 'x' }),
      JSON.stringify({ coin: 'ETH', hash: 'h', at: NOW, amount: '1', to: '0x' + '1'.repeat(40) }),
    ]) {
      localStorage.setItem(LAST_SEND_STORAGE_KEY, bad);
      expect(readLastSend(NOW)).toBeNull();
    }
  });

  it('no hash → nothing recorded; storage errors never throw', () => {
    recordLastSend({ coin: 'ETH', hash: '', amount: '1', to: '0xabc' }, NOW);
    expect(localStorage.getItem(LAST_SEND_STORAGE_KEY)).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => recordLastSend({ coin: 'ETH', hash: '0x1', amount: '1', to: '0xabc' }, NOW)).not.toThrow();
    spy.mockRestore();
  });

  it('shortRecipient keeps short strings and cuts long ones to 4…4', () => {
    expect(shortRecipient('abc')).toBe('abc');
    expect(shortRecipient('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')).toBe('TUEZ…WYdH');
  });
});
