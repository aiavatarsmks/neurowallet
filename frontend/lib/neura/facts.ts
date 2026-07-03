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
  totalEur: number;
  coins: RecapCoinFact[];
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

/** Факты recap из снапшота балансов (WalletBalances). */
export function recapFacts(b: {
  eth: number; sol: number; btc: number; trx: number; ton: number;
  usdt: number; usdtTrc: number; usdtTon: number;
  ethEur: number; solEur: number; btcEur: number; trxEur: number; tonEur: number;
  ethChange24h?: number; solChange24h?: number; btcChange24h?: number;
  trxChange24h?: number; tonChange24h?: number;
}): RecapFacts {
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
    coin('USDT', b.usdt, 0.92, undefined),
    coin('TRC20', b.usdtTrc, 0.92, undefined),
    coin('USDT_TON', b.usdtTon, 0.92, undefined),
  ].filter((c) => c.balance > 0);

  return {
    kind: 'recap',
    totalEur: +coins.reduce((s, c) => s + c.eur, 0).toFixed(2),
    coins,
  };
}
