/**
 * lib/tg-notify-client.ts
 * Client side of POST /api/tg-notify (Telegram "transaction sent" message).
 *
 * The server composes the text from validated fields only
 * (lib/server/tg-notify-template.ts); the old `{ message: html }` body now gets
 * 400. This module builds the structured body and fails closed: if a field
 * cannot be expressed in the server's strict format, no notification is sent.
 * The call is best-effort and its response is ignored.
 */

export type TxSentCoin = 'ETH' | 'USDT' | 'BTC' | 'SOL' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

export interface TxSentNoticeBody {
  kind: 'tx_sent';
  coin: TxSentCoin;
  amount: string;
  to: string;
  hash: string;
  lang: 'ru' | 'en';
}

// Mirrors the server validators in lib/server/tg-notify-template.ts.
const AMOUNT_RE = /^\d{1,18}(\.\d{1,18})?$/;
const REF_RE = /^[A-Za-z0-9:_\-.]{1,128}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The decimal string the user typed (already sanitized to digits and one dot)
 * in the server's format: "1." → "1", ".5" → "0.5". Never goes through Number,
 * so 0.0000001 stays "0.0000001" instead of "1e-7". Zero or anything else that
 * does not fit → null.
 */
export function noticeAmount(typed: string): string | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(typed.trim());
  if (!m) return null;
  const int = m[1] || '0';
  const frac = m[2] ?? '';
  if (!/[1-9]/.test(int + frac)) return null;
  const out = frac ? `${int}.${frac}` : int;
  return AMOUNT_RE.test(out) ? out : null;
}

/**
 * Address / hash in the server's charset. A base64 value (`+`, `/`, `=`) is
 * re-encoded as base64url (same bytes); anything else that does not fit → null.
 */
export function noticeRef(value: string): string | null {
  const v = value.trim();
  if (REF_RE.test(v)) return v;
  if (BASE64_RE.test(v)) {
    const url = v.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return REF_RE.test(url) ? url : null;
  }
  return null;
}

const COINS: Record<TxSentCoin, true> = {
  ETH: true, USDT: true, BTC: true, SOL: true, TRX: true, TRC20: true, TON: true, USDT_TON: true,
};

/** Structured body for /api/tg-notify, or null when it would not validate. */
export function buildTxSentNotice(input: {
  coin: string;
  amount: string;
  to: string;
  hash: string;
  lang: string;
}): TxSentNoticeBody | null {
  if (!(input.coin in COINS)) return null;
  const amount = noticeAmount(input.amount);
  const to = noticeRef(input.to);
  const hash = noticeRef(input.hash);
  if (!amount || !to || !hash) return null;
  return {
    kind: 'tx_sent',
    coin: input.coin as TxSentCoin,
    amount,
    to,
    hash,
    lang: input.lang === 'en' ? 'en' : 'ru',
  };
}

/** Fire-and-forget POST. Never throws; the response is ignored. */
export async function postTxSentNotice(
  body: TxSentNoticeBody,
  token: string,
  traceId?: string,
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (traceId) headers['x-trace-id'] = traceId;
    await fetch('/api/tg-notify', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    /* best-effort: a lost notification never affects the send */
  }
}
