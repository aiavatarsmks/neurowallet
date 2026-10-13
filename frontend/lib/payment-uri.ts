/**
 * lib/payment-uri.ts
 * QR payload for receiving. With a requested amount the QR carries a payment
 * URI, so a scanning wallet pre-fills network and amount; the visible and
 * copyable text stays the raw address (only the QR uses this). Pure string
 * and BigInt math for wei / nanotons, never floats.
 *
 *   BTC   bitcoin:<addr>[?amount=<btc>]              BIP 21
 *   ETH   ethereum:<addr>@1?value=<wei>              EIP 681 (no amount: raw address)
 *   TON   ton://transfer/<addr>[?amount=<nanotons>]
 *   SOL   solana:<addr>?amount=<sol>                 Solana Pay (no amount: raw address)
 *   USDT (ERC-20 / TRC-20 / TON) and TRX: raw address. A token URI needs the
 *   contract and per-wallet support; a wrong one could make the payer's
 *   wallet send the native coin instead.
 */

export type PaymentUriCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

const DECIMALS = { BTC: 8, ETH: 18, SOL: 9, TON: 9 } as const;

/**
 * Canonical positive decimal: ".5" → "0.5", "1.50" → "1.5", "007" → "7".
 * null for zero, malformed input or more fractional digits than `maxDecimals`
 * (never silently rounded: a QR must not ask for a different amount).
 */
export function normalizeDecimal(amount: string, maxDecimals: number): string | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const int = (m[1] || '0').replace(/^0+(?=\d)/, '');
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > maxDecimals) return null;
  if (!/[1-9]/.test(int + frac)) return null;
  return frac ? `${int}.${frac}` : int;
}

/** Decimal string → integer base units (wei, nanotons) as a decimal string. */
export function decimalToUnits(amount: string, decimals: number): string | null {
  const n = normalizeDecimal(amount, decimals);
  if (n === null) return null;
  const [int, frac = ''] = n.split('.');
  return (BigInt(int) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0'))).toString();
}

/** QR content for `address` on `coin`, with `amount` (decimal string) when one is requested. */
export function buildPaymentUri(coin: PaymentUriCoin, address: string, amount?: string | null): string {
  const addr = address.trim();
  if (!addr) return '';
  const amt = amount ?? '';

  switch (coin) {
    case 'BTC': {
      const btc = normalizeDecimal(amt, DECIMALS.BTC);
      return btc ? `bitcoin:${addr}?amount=${btc}` : `bitcoin:${addr}`;
    }
    case 'ETH': {
      const wei = decimalToUnits(amt, DECIMALS.ETH);
      return wei ? `ethereum:${addr}@1?value=${wei}` : addr;
    }
    case 'TON': {
      // URL path: the url-safe form of a user-friendly address (same account).
      const tonAddr = addr.replace(/\+/g, '-').replace(/\//g, '_');
      const nano = decimalToUnits(amt, DECIMALS.TON);
      return nano ? `ton://transfer/${tonAddr}?amount=${nano}` : `ton://transfer/${tonAddr}`;
    }
    case 'SOL': {
      const sol = normalizeDecimal(amt, DECIMALS.SOL);
      return sol ? `solana:${addr}?amount=${sol}` : addr;
    }
    default:
      return addr; // USDT ERC-20 / TRC-20 / TON, TRX
  }
}

export function isPaymentUriCoin(coin: unknown): coin is PaymentUriCoin {
  return typeof coin === 'string' && ['BTC', 'ETH', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON'].includes(coin);
}
