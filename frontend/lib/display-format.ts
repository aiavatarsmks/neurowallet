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
export function sanitizeAmountInput(raw: string): string {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  return v;
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
