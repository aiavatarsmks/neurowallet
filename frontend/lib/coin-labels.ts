/**
 * lib/coin-labels.ts — единые отображаемые имена монет.
 * Внутренние коды (USDT / TRC20 / USDT_TON) остаются прежними — меняется
 * только то, что видит пользователь: все варианты USDT названы явно,
 * чтобы «USDT» не означал молча ERC-20.
 */

export type CoinCode = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

export const COIN_LABELS: Record<CoinCode, string> = {
  BTC: 'BTC',
  ETH: 'ETH',
  SOL: 'SOL',
  TRX: 'TRX',
  TON: 'TON',
  USDT: 'USDT ERC-20',
  TRC20: 'USDT TRC-20',
  USDT_TON: 'USDT TON',
};

export function coinLabel(code: string): string {
  return COIN_LABELS[code as CoinCode] ?? code;
}

/** Порядок пикеров: USDT TRC-20 первым (самый используемый), затем остальные. */
export const COIN_PICKER_ORDER: readonly CoinCode[] = [
  'TRC20', 'USDT', 'USDT_TON', 'ETH', 'BTC', 'SOL', 'TRX', 'TON',
];
