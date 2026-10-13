/**
 * lib/last-send.ts: the last broadcast transfer, remembered on this device.
 *
 * Written the moment a send has a hash (broadcast accepted, or outcome unknown
 * per lib/crypto/broadcast-error.ts). When the send screen opens again within
 * LAST_SEND_MAX_AGE_MS it shows the transfer with its live status, so a user
 * who left the screen or closed the app mid-send sees that the money may
 * already be on its way before sending it again.
 *
 * Contents are public, display-only data: coin, chain hash, time, the amount
 * string the user typed and the recipient in SHORT form (never the full
 * address). Nothing secret, nothing that feeds another chain action.
 * Every storage access is wrapped: a disabled or full storage just means no
 * banner.
 */

export const LAST_SEND_STORAGE_KEY = 'nw_last_send_v1';
export const LAST_SEND_MAX_AGE_MS = 30 * 60_000;

const COINS = new Set(['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON']);
export type LastSendCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

export interface LastSend {
  coin: LastSendCoin;
  /** Chain hash / txid / signature as the status poller expects it (TON: 'ton:seqno:N'). */
  hash: string;
  /** Epoch ms when the hash became known. */
  at: number;
  /** Decimal string as shown on the review (never JS number formatting). */
  amount: string;
  /** Recipient, short form only: '9WzD…AWWM'. */
  to: string;
}

/** '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' → '9WzD…AWWM'. */
export function shortRecipient(addr: string): string {
  const a = (addr ?? '').trim();
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function isLastSend(v: unknown): v is LastSend {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.coin === 'string' && COINS.has(r.coin)
    && typeof r.hash === 'string' && r.hash.length > 0 && r.hash.length <= 200
    && typeof r.at === 'number' && Number.isFinite(r.at)
    && typeof r.amount === 'string' && /^\d+(\.\d+)?$/.test(r.amount) && r.amount.length <= 48
    && typeof r.to === 'string' && r.to.length <= 16;
}

/** Remember a transfer whose hash is known. Never throws. */
export function recordLastSend(
  entry: { coin: LastSendCoin; hash: string; amount: string; to: string },
  now: number = Date.now(),
): void {
  if (typeof window === 'undefined') return;
  const record: LastSend = {
    coin: entry.coin,
    hash: entry.hash,
    at: now,
    amount: entry.amount,
    to: shortRecipient(entry.to),
  };
  if (!isLastSend(record)) return;
  try {
    localStorage.setItem(LAST_SEND_STORAGE_KEY, JSON.stringify(record));
  } catch { /* storage unavailable: no banner, nothing else depends on it */ }
}

/**
 * The remembered transfer if it is younger than LAST_SEND_MAX_AGE_MS and was
 * not dismissed, else null. Expired or malformed entries are removed.
 */
export function readLastSend(now: number = Date.now()): LastSend | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_SEND_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const age = isLastSend(parsed) ? now - parsed.at : NaN;
    if (!isLastSend(parsed) || !(age >= 0 && age < LAST_SEND_MAX_AGE_MS)) {
      localStorage.removeItem(LAST_SEND_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** The user closed the banner: forget the transfer. Never throws. */
export function dismissLastSend(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LAST_SEND_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}
