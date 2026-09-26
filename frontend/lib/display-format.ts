export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  if (value === 0) return '0%';

  const sign = value > 0 ? '+' : '-';
  const abs = Math.abs(value);
  if (abs < 0.01) return `${sign}<0.01%`;

  return `${sign}${abs.toLocaleString('ru-RU', {
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  })}%`;
}

/**
 * Sanitize a free-typed amount: digits + a single decimal point only (comma is
 * converted to dot for RU keyboards). Pair with type="text" inputMode="decimal"
 * — type="number" gives an unreliable mobile keypad (locale comma/dot, no
 * decimal key on some Android/Telegram WebViews, spinner arrows, 'e'/+/-).
 */
export function sanitizeAmountInput(raw: string, maxDecimals?: number): string {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) {
    let frac = v.slice(dot + 1).replace(/\./g, '');
    // Точность сети (USDT — 6, BTC — 8, …): лишние знаки иначе роняют подпись.
    if (maxDecimals !== undefined) frac = frac.slice(0, maxDecimals);
    v = v.slice(0, dot + 1) + frac;
  }
  return v;
}

/** On-chain decimals per coin (USDT — 6 во всех трёх сетях). */
export const COIN_DECIMALS: Record<string, number> = {
  ETH: 18, USDT: 6, BTC: 8, SOL: 9, TRX: 6, TRC20: 6, TON: 9, USDT_TON: 6,
};

/**
 * Number → plain decimal string for parseUnits/toNano: never exponent form
 * (String(1e-7) === '1e-7' ломает ethers/toNano), truncated to `decimals`.
 */
export function amountToDecimalString(n: number, decimals: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error('Некорректная сумма.');
  return n.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: decimals,
    // truncate, never round up past the user's balance (ignored on old engines → rounds)
    roundingMode: 'trunc',
  } as Intl.NumberFormatOptions);
}

export function formatCryptoAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';

  const abs = Math.abs(value);
  if (abs < 0.000001) return '<0.000001';

  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: abs < 1 ? 6 : abs < 100 ? 4 : 2,
  });
}
