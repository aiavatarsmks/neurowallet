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
import { estimateTronFee, tronStaticFeeEstimate, type TronFeeEstimate } from './tron-tx';
import type { TranslationKey } from '../i18n';

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
  /** Additive: the specific reason behind `code` (UI: SIM_DETAIL_I18N[detail]). */
  detail?: SimWarningDetail;
}

/** Specific reasons that ride on an existing warning code, or come as notices. */
export type SimWarningDetail =
  | 'tron_fee_limit_exceeded'        // block: energy cost > fee_limit → OUT_OF_ENERGY
  | 'tron_fee_estimate_unavailable'  // warn: live TRON estimate failed, static fee shown
  | 'tron_recipient_not_activated';  // notice: TRX to a new account, +1 TRX creation fee

/** Non-blocking note without a SimWarning code yet (older UIs ignore it). */
export interface SimNotice {
  level: 'warn';
  detail: SimWarningDetail;
}

export interface SimulationResult {
  status: 'ok' | 'timeout' | 'error';
  feeNative: number | null;   // комиссия в fee-валюте чейна
  feeCurrency: string;        // ETH | BTC | SOL | TRX | TON
  feeEur: number | null;
  balanceAfter: number | null; // остаток отправляемой монеты после перевода
  warnings: SimWarning[];
  /** Additive: non-blocking notices (currently TRON only). */
  notices?: SimNotice[];
  /** Additive: TRON fee breakdown, set for TRX / TRC20 only. */
  tron?: TronFeeEstimate;
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
  /** Свой TRON-адрес для оценки энергии; по умолчанию wallet_tron_address из localStorage. */
  fromTronAddress?: string;
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
  TRX: 1.1,          // TRON: fallback, если живая оценка недоступна (худший случай: новый аккаунт)
  TRC20: 14,         // TRON: fallback, если живая оценка энергии недоступна
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
export async function estimateFeeNative(params: Pick<SimulateParams, 'coin' | 'amount' | 'fromBtcAddress'>): Promise<number> {
  const { coin } = params;

  if (coin === 'ETH' || coin === 'USDT') {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const feeData = await provider.getFeeData();
    // ethers шлёт EIP-1559 tx и проверяет баланс по maxFeePerGas (≈2× base fee).
    // Оценка по legacy gasPrice занижала резерв → «почти MAX» проходил review
    // и падал с insufficient funds. Берём верхнюю границу.
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(20e9);
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
  const tronSim: { est?: TronFeeEstimate } = {}; // TRON: live energy/bandwidth estimate
  try {
    feeNative = await withTimeout(
      isTronCoin(coin)
        ? estimateTronForSim(params, warnings.length === 0).then((est) => {
            tronSim.est = est;
            return est.feeTrx;
          })
        : estimateFeeNative(params),
      params.timeoutMs ?? 8_000,
    );
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

  const notices: SimNotice[] = [];
  if (tronSim.est) applyTronWarnings(tronSim.est, warnings, notices);

  return {
    status,
    feeNative,
    feeCurrency: feeCur.label,
    feeEur: feeNative !== null ? feeNative * (eurRates[feeCur.eurKey] || 0) : null,
    balanceAfter,
    warnings,
    ...(notices.length > 0 ? { notices } : {}),
    ...(tronSim.est ? { tron: tronSim.est } : {}),
  };
}

/** true, если среди warnings есть блокирующий. */
export function isBlocked(result: SimulationResult): boolean {
  return result.warnings.some((w) => w.level === 'block');
}

// ─── TRON: live fee estimate (energy, bandwidth, activation) ─────────────────

/** i18n key per SimWarningDetail (keys at the end of lib/i18n.ts), for the UI. */
export const SIM_DETAIL_I18N: Record<SimWarningDetail, TranslationKey> = {
  tron_fee_limit_exceeded: 'simTronFeeLimitExceeded',
  tron_fee_estimate_unavailable: 'simTronFeeEstimateUnavailable',
  tron_recipient_not_activated: 'simTronRecipientNotActivated',
};

function isTronCoin(coin: SimCoin): coin is 'TRX' | 'TRC20' {
  return coin === 'TRX' || coin === 'TRC20';
}

/** Sender's TRON address: explicit param, else the one the wallet stored on creation. */
function senderTronAddress(params: SimulateParams): string {
  if (params.fromTronAddress) return params.fromTronAddress.trim();
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('wallet_tron_address')?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Live estimate when the inputs are valid and the sender is known. Otherwise,
 * or on any provider failure, the previous static value with a flag. Never
 * rejects; the live calls get 3/4 of the simulation timeout so the fallback
 * arrives before the outer timeout.
 */
async function estimateTronForSim(params: SimulateParams, inputsValid: boolean): Promise<TronFeeEstimate> {
  const kind = params.coin === 'TRX' ? 'trx' : 'usdt';
  const staticFee = STATIC_FEE_NATIVE[params.coin] ?? 0;
  if (!inputsValid) return tronStaticFeeEstimate(kind, staticFee, 'invalid_input');
  const from = senderTronAddress(params);
  if (!from) return tronStaticFeeEstimate(kind, staticFee, 'no_sender_address');
  try {
    return await estimateTronFee({
      kind,
      from,
      to: params.toAddress.trim(),
      amount: params.amount,
      timeoutMs: Math.floor((params.timeoutMs ?? 8_000) * 0.75),
    });
  } catch (err) {
    return tronStaticFeeEstimate(kind, staticFee, err instanceof Error ? err.message.slice(0, 80) : 'error');
  }
}

/**
 * Map the TRON estimate onto the EXISTING warning codes, so the current send
 * screen shows and blocks it without changes; `detail` names the exact reason.
 */
function applyTronWarnings(est: TronFeeEstimate, warnings: SimWarning[], notices: SimNotice[]): void {
  if (est.exceedsFeeLimit) {
    // One entry per code (the UI keys warnings by code).
    const existing = warnings.find((w) => w.code === 'insufficient_fee_balance');
    if (existing) {
      existing.level = 'block';
      existing.detail = 'tron_fee_limit_exceeded';
    } else {
      warnings.push({ level: 'block', code: 'insufficient_fee_balance', detail: 'tron_fee_limit_exceeded' });
    }
  }
  if (est.source === 'static' && est.unavailableReason !== 'invalid_input'
      && !warnings.some((w) => w.code === 'simulation_failed')) {
    warnings.push({ level: 'warn', code: 'simulation_failed', detail: 'tron_fee_estimate_unavailable' });
  }
  if (est.recipientActivated === false) {
    notices.push({ level: 'warn', detail: 'tron_recipient_not_activated' });
  }
}
