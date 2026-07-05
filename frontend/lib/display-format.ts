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

export function formatCryptoAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';

  const abs = Math.abs(value);
  if (abs < 0.000001) return '<0.000001';

  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: abs < 1 ? 6 : abs < 100 ? 4 : 2,
  });
}
