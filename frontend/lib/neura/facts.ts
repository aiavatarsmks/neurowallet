/**
 * lib/neura/facts.ts — детерминированная сборка фактов для Нейры (задача 1.7).
 *
 * Инвариант: LLM ТОЛЬКО оформляет текст из провалидированных фактов —
 * никакой генерации поверх сырых данных, никакого доступа к ключам.
 * Факты собираются из уже-decoded структур (TxRow из tx-history, балансы
 * из fetchRealBalances). Всё, чего нет в фактах, для Нейры не существует.
 */

export type FactChain = 'ETH' | 'SOL' | 'BTC' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

export interface TxFacts {
  kind: 'tx';
  chain: FactChain;
  direction: 'in' | 'out';
  amount: number;
  /** Усечённый контрагент (не полный адрес — наружу уходит только вид 0x1234…abcd). */
  counterparty: string;
  date: string;      // ISO
  fee: number | 'unknown';
}

export interface RecapCoinFact {
  coin: FactChain;
  balance: number;
  eur: number;
  change24h: number | 'unknown';
}

export interface RecapFacts {
  kind: 'recap';
  /** Sum over `coins` only: coins whose balance could not be refreshed are not in it. */
  totalEur: number;
  coins: RecapCoinFact[];
  /** Coins whose balance could not be refreshed: unknown, never stated as 0. */
  unavailable: FactChain[];
}

export type NeuraFacts = TxFacts | RecapFacts;

export function shortAddress(addr: string): string {
  const a = (addr ?? '').trim();
  if (a.length <= 14) return a || 'unknown';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Факты из строки истории транзакций (TxRow — уже decoded/validated). */
export function txFacts(row: {
  chain: FactChain;
  type: 'in' | 'out';
  amount: number;
  address: string;
  date: string;
  fee: number;
}): TxFacts {
  return {
    kind: 'tx',
    chain: row.chain,
    direction: row.type,
    amount: Number.isFinite(row.amount) ? row.amount : 0,
    counterparty: shortAddress(row.address),
    date: row.date,
    fee: Number.isFinite(row.fee) && row.fee > 0 ? row.fee : 'unknown',
  };
}

/** AssetSymbol (lib/crypto/assets) → FactChain. */
const ASSET_TO_FACT: Record<string, FactChain> = {
  BTC: 'BTC', ETH: 'ETH', SOL: 'SOL', USDT: 'USDT', TRX: 'TRX', USDT_TRC: 'TRC20', TON: 'TON', USDT_TON: 'USDT_TON',
};

/**
 * Факты recap из снапшота балансов (WalletBalances). Монеты из
 * `b.unavailable` (провайдер не ответил) не попадают в coins/totalEur: их
 * число в снапшоте либо последнее известное, либо 0-заглушка, и Нейра не
 * должна выдавать его за текущий баланс. Они перечислены в `unavailable`.
 */
export function recapFacts(b: {
  eth: number; sol: number; btc: number; trx: number; ton: number;
  usdt: number; usdtTrc: number; usdtTon: number;
  ethEur: number; solEur: number; btcEur: number; trxEur: number; tonEur: number;
  usdtEur?: number;
  ethChange24h?: number; solChange24h?: number; btcChange24h?: number;
  trxChange24h?: number; tonChange24h?: number;
  unavailable?: readonly string[];
}): RecapFacts {
  const unavailable = [...new Set((b.unavailable ?? []).map((s) => ASSET_TO_FACT[s]).filter(Boolean))];
  const usdtEur = typeof b.usdtEur === 'number' && Number.isFinite(b.usdtEur) && b.usdtEur > 0 ? b.usdtEur : 0.92;
  const coin = (c: FactChain, balance: number, rate: number, change?: number): RecapCoinFact => ({
    coin: c,
    balance: Number.isFinite(balance) ? balance : 0,
    eur: Number.isFinite(balance * rate) ? +(balance * rate).toFixed(2) : 0,
    change24h: typeof change === 'number' && Number.isFinite(change) ? +change.toFixed(2) : 'unknown',
  });

  const coins: RecapCoinFact[] = [
    coin('BTC', b.btc, b.btcEur, b.btcChange24h),
    coin('ETH', b.eth, b.ethEur, b.ethChange24h),
    coin('SOL', b.sol, b.solEur, b.solChange24h),
    coin('TRX', b.trx, b.trxEur, b.trxChange24h),
    coin('TON', b.ton, b.tonEur, b.tonChange24h),
    coin('USDT', b.usdt, usdtEur, undefined),
    coin('TRC20', b.usdtTrc, usdtEur, undefined),
    coin('USDT_TON', b.usdtTon, usdtEur, undefined),
  ].filter((c) => c.balance > 0 && !unavailable.includes(c.coin));

  return {
    kind: 'recap',
    totalEur: +coins.reduce((s, c) => s + c.eur, 0).toFixed(2),
    coins,
    unavailable,
  };
}
