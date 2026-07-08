/**
 * lib/demo-data.ts — single source of truth for demo-mode mock figures.
 *
 * Before this, the home balance card, the portfolio (WalletScreen) and the
 * crypto send screen each hardcoded their OWN demo numbers, so a demo user saw
 * e.g. TON = 0 in the portfolio but TON = 32 when sending, and different totals
 * on home vs the assets tab. Everything demo now derives from here, and all
 * totals are COMPUTED from the holdings so they can't drift apart.
 *
 * Demo makes no chain/wallet-API calls — these are display-only fixtures.
 */
import type { AssetSymbol } from './crypto/assets';

export interface DemoHolding {
  symbol: AssetSymbol;
  amount: number;
  priceEUR: number; // USDT variants pegged to 1
  change24h: number; // percent
}

export const DEMO_HOLDINGS: DemoHolding[] = [
  { symbol: 'BTC',      amount: 0.042, priceEUR: 55000, change24h: 4.2 },
  { symbol: 'ETH',      amount: 1.24,  priceEUR: 2050,  change24h: 1.8 },
  { symbol: 'SOL',      amount: 12.5,  priceEUR: 120,   change24h: 3.4 },
  { symbol: 'USDT',     amount: 110,   priceEUR: 1,     change24h: 0 },
  { symbol: 'TRX',      amount: 250,   priceEUR: 0.22,  change24h: -0.6 },
  { symbol: 'USDT_TRC', amount: 85,    priceEUR: 1,     change24h: 0 },
  { symbol: 'TON',      amount: 32,    priceEUR: 3.5,   change24h: 2.1 },
  { symbol: 'USDT_TON', amount: 45,    priceEUR: 1,     change24h: 0 },
];

export const demoValueEUR = (h: DemoHolding): number => h.amount * h.priceEUR;

export const DEMO_HOLDING: Record<AssetSymbol, DemoHolding> = Object.fromEntries(
  DEMO_HOLDINGS.map((h) => [h.symbol, h]),
) as Record<AssetSymbol, DemoHolding>;

export const DEMO_CRYPTO_TOTAL_EUR = DEMO_HOLDINGS.reduce((s, h) => s + demoValueEUR(h), 0);

export interface DemoFiatAccount {
  label: string;
  valueEUR: number;
}
export const DEMO_FIAT_ACCOUNTS: DemoFiatAccount[] = [
  { label: 'Основной счёт', valueEUR: 2000.0 },
  { label: 'Накопительный', valueEUR: 847.5 },
];
export const DEMO_FIAT_TOTAL_EUR = DEMO_FIAT_ACCOUNTS.reduce((s, a) => s + a.valueEUR, 0);
export const DEMO_TOTAL_EUR = DEMO_CRYPTO_TOTAL_EUR + DEMO_FIAT_TOTAL_EUR;

/** Portfolio sparkline bars (visual only). */
export const DEMO_CHART_BARS = [35, 48, 40, 58, 44, 66, 60, 72, 55, 78, 68, 82, 88, 78, 92];
