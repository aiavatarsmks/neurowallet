/**
 * lib/crypto/simulate.ts — предполётная симуляция перевода (задача 1.2).
 *
 * Полностью client-side, MVP-охват: нативные переводы + USDT (ERC-20 /
 * TRC-20 / TON Jetton). Считает реальную комиссию (где есть RPC), проверяет
 * адрес, сумму и достаточность балансов С УЧЁТОМ комиссии, и возвращает
 * типизированные warnings: `block` запрещает отправку, `warn` — предупреждает.
 *
 * Таймаут симуляции — явный результат `timeout` с warning'ом, а не тихий
 * пропуск (приёмка 1.2). Никаких ключей/паролей здесь нет и быть не может.
 */

import { ethers } from 'ethers';
import {
  isValidEthAddress,
  isValidSolAddress,
  isValidBtcAddress,
  isValidTronAddress,
  isValidTonAddress,
} from './transactions';
import { fetchUTXOs, getBtcFeeRate } from './btc-tx';

export type SimCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';

export interface SimWarning {
  level: 'block' | 'warn';
  code:
    | 'invalid_address'
    | 'invalid_amount'
    | 'insufficient_funds'
    | 'insufficient_fee_balance'
    | 'simulation_timeout'
    | 'simulation_failed';
}

export interface SimulationResult {
  status: 'ok' | 'timeout' | 'error';
  feeNative: number | null;   // комиссия в fee-валюте чейна
  feeCurrency: string;        // ETH | BTC | SOL | TRX | TON
  feeEur: number | null;
  balanceAfter: number | null; // остаток отправляемой монеты после перевода
  warnings: SimWarning[];
}

export interface SimulateParams {
  coin: SimCoin;
  toAddress: string;
  amount: number;
  /** Балансы всех монет пользователя (нужны и токен, и нативный для комиссии). */
  balances: Record<SimCoin, number>;
  /** EUR-курсы нативных монет для показа комиссии в евро. */
  eurRates: { eth: number; btc: number; sol: number; trx: number; ton: number };
  /** Свой BTC-адрес — нужен для реального подбора UTXO. */
  fromBtcAddress?: string;
  /** Таймаут RPC-части симуляции, мс. */
  timeoutMs?: number;
}

const ETH_RPC = 'https://cloudflare-eth.com';

/** Нативная монета, которой платится комиссия за перевод данной монеты. */
export const FEE_CURRENCY: Record<SimCoin, { coin: SimCoin; label: string; eurKey: keyof SimulateParams['eurRates'] }> = {
  ETH:      { coin: 'ETH', label: 'ETH', eurKey: 'eth' },
  USDT:     { coin: 'ETH', label: 'ETH', eurKey: 'eth' },
  BTC:      { coin: 'BTC', label: 'BTC', eurKey: 'btc' },
  SOL:      { coin: 'SOL', label: 'SOL', eurKey: 'sol' },
  TRX:      { coin: 'TRX', label: 'TRX', eurKey: 'trx' },
  TRC20:    { coin: 'TRX', label: 'TRX', eurKey: 'trx' },
  TON:      { coin: 'TON', label: 'TON', eurKey: 'ton' },
  USDT_TON: { coin: 'TON', label: 'TON', eurKey: 'ton' },
};

const VALIDATORS: Record<SimCoin, (addr: string) => boolean> = {
  ETH: isValidEthAddress,
  USDT: isValidEthAddress,
  SOL: isValidSolAddress,
  BTC: isValidBtcAddress,
  TRX: isValidTronAddress,
  TRC20: isValidTronAddress,
  TON: isValidTonAddress,
  USDT_TON: isValidTonAddress,
};

const GAS_LIMIT_NATIVE = 21_000n;
const GAS_LIMIT_ERC20 = 65_000n;

/** Детерминированные MVP-оценки для чейнов без дешёвого RPC-эстимейта. */
const STATIC_FEE_NATIVE: Partial<Record<SimCoin, number>> = {
  SOL: 0.000005,     // 5000 лампортов
  TRX: 1.1,          // bandwidth burn
  TRC20: 14,         // energy burn (без замороженных ресурсов)
  TON: 0.01,
  USDT_TON: 0.06,    // jetton transfer + forward fee
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SIM_TIMEOUT')), ms)),
  ]);
}

/** Реальная RPC-оценка комиссии (в нативной монете) для ETH/USDT/BTC. */
async function estimateFeeNative(params: SimulateParams): Promise<number> {
  const { coin } = params;

  if (coin === 'ETH' || coin === 'USDT') {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? BigInt(20e9);
    const gasLimit = coin === 'ETH' ? GAS_LIMIT_NATIVE : GAS_LIMIT_ERC20;
    return parseFloat(ethers.formatEther(gasLimit * gasPrice));
  }

  if (coin === 'BTC') {
    // Без собственного адреса реальный подбор UTXO невозможен — грубая оценка.
    if (!params.fromBtcAddress) return 0.00002;
    const [utxos, feeRate] = await Promise.all([
      fetchUTXOs(params.fromBtcAddress),
      getBtcFeeRate(),
    ]);
    // Жадный подбор UTXO под сумму; vbytes ≈ 10 + 68*inputs + 31*outputs (P2WPKH).
    const amountSat = Math.round(params.amount * 1e8);
    let selected = 0;
    let inputSat = 0;
    for (const u of utxos.filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value)) {
      selected += 1;
      inputSat += u.value;
      if (inputSat >= amountSat) break;
    }
    const vbytes = 10 + 68 * Math.max(selected, 1) + 31 * 2;
    return (vbytes * feeRate) / 1e8;
  }

  const staticFee = STATIC_FEE_NATIVE[coin];
  if (staticFee !== undefined) return staticFee;
  throw new Error(`No fee model for ${coin}`);
}

export async function simulateTransfer(params: SimulateParams): Promise<SimulationResult> {
  const { coin, toAddress, amount, balances, eurRates } = params;
  const feeCur = FEE_CURRENCY[coin];
  const warnings: SimWarning[] = [];

  // Детерминированные проверки — всегда, даже если RPC лежит.
  if (!VALIDATORS[coin](toAddress.trim())) {
    warnings.push({ level: 'block', code: 'invalid_address' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    warnings.push({ level: 'block', code: 'invalid_amount' });
  }

  let status: SimulationResult['status'] = 'ok';
  let feeNative: number | null = null;
  try {
    feeNative = await withTimeout(estimateFeeNative(params), params.timeoutMs ?? 8_000);
  } catch (err) {
    status = err instanceof Error && err.message === 'SIM_TIMEOUT' ? 'timeout' : 'error';
    warnings.push({
      level: 'warn',
      code: status === 'timeout' ? 'simulation_timeout' : 'simulation_failed',
    });
  }

  // Достаточность баланса — с учётом комиссии, если она известна.
  const sendBalance = balances[coin] ?? 0;
  const feeBalance = balances[feeCur.coin] ?? 0;
  const sameCurrency = feeCur.coin === coin;

  if (sameCurrency) {
    const needed = amount + (feeNative ?? 0);
    if (needed > sendBalance) warnings.push({ level: 'block', code: 'insufficient_funds' });
  } else {
    if (amount > sendBalance) warnings.push({ level: 'block', code: 'insufficient_funds' });
    if (feeNative !== null && feeNative > feeBalance) {
      warnings.push({ level: 'block', code: 'insufficient_fee_balance' });
    }
  }

  const balanceAfter =
    amount <= sendBalance
      ? Math.max(0, sendBalance - amount - (sameCurrency ? feeNative ?? 0 : 0))
      : null;

  return {
    status,
    feeNative,
    feeCurrency: feeCur.label,
    feeEur: feeNative !== null ? feeNative * (eurRates[feeCur.eurKey] || 0) : null,
    balanceAfter,
    warnings,
  };
}

/** true, если среди warnings есть блокирующий. */
export function isBlocked(result: SimulationResult): boolean {
  return result.warnings.some((w) => w.level === 'block');
}
