/**
 * lib/server/neura-chat-input.ts
 * Strict input shaping for /api/neura-chat (cost + prompt-injection hardening).
 *
 * - History: only 'user' / 'assistant' turns with string content are kept
 *   (a client-sent 'system' turn could override Neura's instructions), the
 *   last NEURA_MAX_MESSAGES of them, each TRUNCATED to NEURA_MAX_MESSAGE_CHARS
 *   (truncate, not 400: the client sends its whole chat and an old long reply
 *   must not lock the user out).
 * - walletContext: an allowlist. Balances/prices must be finite numbers and
 *   are clamped; addresses must match a per-chain regex (same ones as
 *   /api/tx-history). Everything else is dropped, so nothing free-form from
 *   the client ever lands in the system prompt.
 */

export const NEURA_MAX_MESSAGES = 12;
export const NEURA_MAX_MESSAGE_CHARS = 2000;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface WalletContext {
  eth?: number; btc?: number; sol?: number; trx?: number; ton?: number; usdt?: number; usdtTrc?: number; usdtTon?: number;
  ethEur?: number; btcEur?: number; solEur?: number; trxEur?: number; tonEur?: number;
  ethAddr?: string; btcAddr?: string; solAddr?: string; tronAddr?: string; tonAddr?: string;
}

const BALANCE_FIELDS = ['eth', 'btc', 'sol', 'trx', 'ton', 'usdt', 'usdtTrc', 'usdtTon'] as const;
const PRICE_FIELDS = ['ethEur', 'btcEur', 'solEur', 'trxEur', 'tonEur'] as const;
const MAX_BALANCE = 1e12;
const MAX_PRICE_EUR = 1e7;

const ADDRESS_FIELDS: Record<'ethAddr' | 'btcAddr' | 'solAddr' | 'tronAddr' | 'tonAddr', RegExp> = {
  ethAddr:  /^0x[a-fA-F0-9]{40}$/,
  btcAddr:  /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  solAddr:  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  tronAddr: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  tonAddr:  /^([A-Za-z0-9_-]{48}|-?\d+:[a-fA-F0-9]{64})$/,
};

export function sanitizeHistory(raw: unknown): { messages: ChatMessage[]; truncated: number } {
  if (!Array.isArray(raw)) return { messages: [], truncated: 0 };
  let truncated = 0;
  const messages = raw
    .filter((m): m is ChatMessage =>
      !!m && typeof m === 'object'
      && ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant')
      && typeof (m as ChatMessage).content === 'string')
    .slice(-NEURA_MAX_MESSAGES)
    .map((m) => {
      if (m.content.length > NEURA_MAX_MESSAGE_CHARS) truncated += 1;
      return { role: m.role, content: m.content.slice(0, NEURA_MAX_MESSAGE_CHARS) };
    });
  return { messages, truncated };
}

function clampNumber(v: unknown, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(0, v));
}

/** Returns only known, well-formed fields, or undefined when nothing survives. */
export function sanitizeWalletContext(raw: unknown): WalletContext | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: WalletContext = {};

  for (const k of BALANCE_FIELDS) {
    const v = clampNumber(src[k], MAX_BALANCE);
    if (v !== undefined) out[k] = v;
  }
  for (const k of PRICE_FIELDS) {
    const v = clampNumber(src[k], MAX_PRICE_EUR);
    if (v !== undefined) out[k] = v;
  }
  for (const [k, re] of Object.entries(ADDRESS_FIELDS) as Array<[keyof typeof ADDRESS_FIELDS, RegExp]>) {
    const v = src[k];
    if (typeof v === 'string' && re.test(v)) out[k] = v;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
