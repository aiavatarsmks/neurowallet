/**
 * lib/server/tg-notify-template.ts
 * Server-composed Telegram messages for /api/tg-notify.
 *
 * The client only sends validated fields; the text and HTML markup are fixed
 * here. Every interpolated value is HTML-escaped (parse_mode: 'HTML'), even
 * though the validators below already exclude markup characters.
 */

export const TG_NOTIFY_COINS = ['ETH', 'USDT', 'BTC', 'SOL', 'TRX', 'TRC20', 'TON', 'USDT_TON'] as const;
export type TgNotifyCoin = (typeof TG_NOTIFY_COINS)[number];
export type TgNotifyLang = 'ru' | 'en';

const COIN_LABELS: Record<TgNotifyCoin, string> = {
  ETH: 'ETH',
  USDT: 'USDT (ERC-20)',
  BTC: 'BTC',
  SOL: 'SOL',
  TRX: 'TRX',
  TRC20: 'USDT (TRC-20)',
  TON: 'TON',
  USDT_TON: 'USDT (TON)',
};

const AMOUNT_RE = /^\d{1,18}(\.\d{1,18})?$/;
const REF_RE = /^[A-Za-z0-9:_\-.]{1,128}$/;

export interface TxSentNotice {
  kind: 'tx_sent';
  coin: TgNotifyCoin;
  amount: string;
  to: string;
  hash: string;
  lang: TgNotifyLang;
}

export type ParseResult =
  | { ok: true; value: TxSentNotice }
  | { ok: false; error: string };

/** Strict parser for the tg-notify body. Unknown fields are ignored. */
export function parseTxSentNotice(body: unknown): ParseResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.kind !== 'tx_sent') return { ok: false, error: 'invalid kind' };
  if (typeof b.coin !== 'string' || !(TG_NOTIFY_COINS as readonly string[]).includes(b.coin)) {
    return { ok: false, error: 'invalid coin' };
  }
  if (typeof b.amount !== 'string' || !AMOUNT_RE.test(b.amount)) return { ok: false, error: 'invalid amount' };
  if (typeof b.to !== 'string' || !REF_RE.test(b.to)) return { ok: false, error: 'invalid to' };
  if (typeof b.hash !== 'string' || !REF_RE.test(b.hash)) return { ok: false, error: 'invalid hash' };

  // lang only picks one of two fixed templates; anything but 'en' means 'ru'.
  return {
    ok: true,
    value: {
      kind: 'tx_sent',
      coin: b.coin as TgNotifyCoin,
      amount: b.amount,
      to: b.to,
      hash: b.hash,
      lang: b.lang === 'en' ? 'en' : 'ru',
    },
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Same layout the client used to build, now composed server-side. */
export function composeTxSentMessage(n: TxSentNotice): string {
  const amount = escapeHtml(n.amount);
  const coin = escapeHtml(COIN_LABELS[n.coin]);
  const shortTo = escapeHtml(`${n.to.slice(0, 6)}...${n.to.slice(-4)}`);
  const shortHash = escapeHtml(n.hash.slice(0, 16));

  return n.lang === 'en'
    ? `✅ <b>Transaction sent</b>\n\n💸 ${amount} ${coin}\n📤 To address: <code>${shortTo}</code>\n🔗 TX: <code>${shortHash}...</code>`
    : `✅ <b>Транзакция отправлена</b>\n\n💸 ${amount} ${coin}\n📤 На адрес: <code>${shortTo}</code>\n🔗 TX: <code>${shortHash}...</code>`;
}
