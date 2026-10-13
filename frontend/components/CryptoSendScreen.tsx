import React, { useState, useEffect, useRef } from 'react';
import { sendEth, sendUsdt, sendUsdtTrc20, sendTrx, sendSol, sendTon, sendUsdtTon, isValidEthAddress, isValidSolAddress, isValidBtcAddress, isValidTronAddress, isValidTonAddress } from '@/lib/crypto/transactions';
// BTC send lives in btc-tx.ts: it signs at the reviewed fee rate (capped).
import { sendBtc, btcErrorCode, BTC_MAX_FEE_RATE_SAT_VB, type BtcErrorCode } from '@/lib/crypto/btc-tx';
import { fetchRealBalances, MARKET_REFRESH_MS, resetSharedBalances } from '@/lib/crypto/balances';
import { isBroadcastOutcomeUnknown } from '@/lib/crypto/broadcast-error';
import { upgradeStoredKeystoreIfWeak } from '@/lib/crypto/keystore-migration';
import { sendLock } from '@/lib/send-lock';
import { recordLastSend, readLastSend, dismissLastSend, type LastSend } from '@/lib/last-send';
import { track, trackOnce, newTraceId } from '@/lib/analytics';
import { coinLabel, COIN_PICKER_ORDER } from '@/lib/coin-labels';
import { DEMO_HOLDING } from '@/lib/demo-data';
import { sanitizeAmountInput, COIN_DECIMALS, amountToDecimalString } from '@/lib/display-format';
import { emitNotification } from '@/lib/notifications-client';
import { buildTxSentNotice, postTxSentNotice } from '@/lib/tg-notify-client';
import { looksLikeTonDnsName, resolveName, type ResolvableChain } from '@/lib/name-resolvers';
import { simulateTransfer, isBlocked, estimateFeeNative, FEE_CURRENCY, SIM_DETAIL_I18N, type SimulationResult, type SimWarning } from '@/lib/crypto/simulate';
import { assessRecipient, type RiskAssessment } from '@/lib/risk/engine';
import { policyEngineEnabled, type PolicyDecision } from '@/lib/policy-engine';
import { evaluateSend } from '@/lib/policy-check';
import { fetchPolicies } from '@/lib/policies-client';
import { txFacts } from '@/lib/neura/facts';
import { completeDemoTask } from '@/lib/demo-guide';
import { fetchExplanation } from '@/lib/neura/explain-client';
import { supabase } from '@/lib/supabase';
import { TX_STATUS_REASON } from '@/lib/crypto/tx-status';
import { useTxStatus } from '@/hooks/useTxStatus';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/lib/i18n';
import { useDisplayCurrency } from '@/contexts/DisplayCurrencyContext';

type Coin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TRX' | 'TRC20' | 'TON' | 'USDT_TON';
type Step = 'form' | 'confirm' | 'password' | 'sending' | 'done';

interface CoinMeta {
  icon:        string;
  color:       string;
  bgColor:     string;
  placeholder: string;
  implemented: boolean; // real send wired up
}

const COINS: Record<Coin, CoinMeta> = {
  ETH:      { icon: 'Ξ', color: '#627EEA', bgColor: 'rgba(98,126,234,0.15)',  placeholder: '0x…',  implemented: true },
  SOL:      { icon: '◎', color: '#9945FF', bgColor: 'rgba(153,69,255,0.15)',  placeholder: 'So1…', implemented: true },
  BTC:      { icon: '₿', color: '#F7931A', bgColor: 'rgba(247,147,26,0.15)',  placeholder: 'bc1…', implemented: true },
  USDT:     { icon: '₮', color: '#26A17B', bgColor: 'rgba(38,161,123,0.15)', placeholder: '0x…',  implemented: true },
  TRX:      { icon: '◆', color: '#EF0027', bgColor: 'rgba(239,0,39,0.12)',   placeholder: 'T…',   implemented: true },
  TRC20:    { icon: '₮', color: '#EF0027', bgColor: 'rgba(239,0,39,0.12)',   placeholder: 'T…',   implemented: true },
  TON:      { icon: '💎', color: '#0098EA', bgColor: 'rgba(0,152,234,0.15)', placeholder: 'EQ…',  implemented: true },
  USDT_TON: { icon: '₮', color: '#0098EA', bgColor: 'rgba(0,152,234,0.12)', placeholder: 'EQ…',  implemented: true },
};

const FEE_ESTIMATE_EUR: Record<Coin, { type: 'range'; min: number; max: number } | { type: 'less'; value: number } | { type: 'about'; value: number }> = {
  ETH: { type: 'range', min: 0.30, max: 1.50 },
  BTC: { type: 'range', min: 0.50, max: 2.00 },
  SOL: { type: 'less', value: 0.01 },
  USDT: { type: 'about', value: 0.30 },
  TRX: { type: 'less', value: 0.01 },
  TRC20: { type: 'less', value: 0.50 },
  TON: { type: 'about', value: 0.01 },
  USDT_TON: { type: 'about', value: 0.05 },
};

const ALL_COINS: Coin[] = ['ETH', 'BTC', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON'];

/**
 * Explorer page for a broadcast transfer. TON sends return 'ton:seqno:N' (the
 * hash exists only once processed), so TON links to the sender's address page.
 */
function explorerTxUrl(coin: Coin, hash: string): string {
  if (coin === 'SOL') return `https://solscan.io/tx/${hash}`;
  if (coin === 'BTC') return `https://blockstream.info/tx/${hash}`;
  if (coin === 'TRX' || coin === 'TRC20') return `https://tronscan.org/#/transaction/${hash}`;
  if (coin === 'TON' || coin === 'USDT_TON') {
    let tonAddr = '';
    try { tonAddr = localStorage.getItem('wallet_ton_address') ?? ''; } catch { /* storage unavailable */ }
    return `https://tonscan.org/address/${encodeURIComponent(tonAddr)}`;
  }
  return `https://etherscan.io/tx/${hash}`;
}

function explorerLabelKey(coin: Coin): TranslationKey {
  if (coin === 'SOL') return 'csViewOnSolscan';
  if (coin === 'BTC') return 'csViewOnBlockstream';
  if (coin === 'TRX' || coin === 'TRC20') return 'csViewOnTronscan';
  if (coin === 'TON' || coin === 'USDT_TON') return 'csViewOnTonscan';
  return 'csViewOnEtherscan';
}

function formatFeeEstimate(coin: Coin, formatFiat: (eurValue: number, options?: Intl.NumberFormatOptions) => string): string {
  const fee = FEE_ESTIMATE_EUR[coin];
  if (fee.type === 'range') return `~${formatFiat(fee.min)}–${formatFiat(fee.max)}`;
  if (fee.type === 'less') return `< ${formatFiat(fee.value)}`;
  return `~${formatFiat(fee.value)}`;
}

const BTC_ERROR_I18N: Record<BtcErrorCode, TranslationKey> = {
  BTC_FEE_RATE_TOO_HIGH: 'csErrBtcFeeRateTooHigh',
  BTC_FEE_TOO_HIGH_VS_AMOUNT: 'csErrBtcFeeVsAmount',
  BTC_INVALID_FEE_RATE: 'csErrBtcInvalidFeeRate',
  BTC_DUST: 'csErrDust',
  BTC_NO_UTXO: 'csErrNoUtxo',
  BTC_INSUFFICIENT_FUNDS: 'csErrBtcInsufficient',
  BTC_UNSUPPORTED_SOURCE: 'csErrBtcUnsupportedSource',
  BTC_UTXO_FETCH_FAILED: 'csErrBtcUnavailable',
  BTC_RAW_TX_FETCH_FAILED: 'csErrBtcUnavailable',
  BTC_BROADCAST_REJECTED: 'csErrBtcRejected',
  BTC_BROADCAST_UNAVAILABLE: 'csErrBtcUnavailable',
};

export interface SendErrorView {
  field: 'password' | 'send';
  key: TranslationKey;
  /** Extra text after the translated message (node reject reason, unmapped lib text). */
  detail?: string;
}

/**
 * Lib error → i18n key. Error codes first (btc-tx.ts), then stable substrings
 * of the libs' messages, several of which are Russian (transactions.ts,
 * tron-tx.ts, aes.ts, display-format.ts): mapping them keeps raw Russian text
 * away from EN users. Unmapped errors fall back to csErrGeneric + detail.
 */
export function describeSendError(e: unknown): SendErrorView {
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw.toLowerCase();
  const send = (key: TranslationKey, detail?: string): SendErrorView => ({ field: 'send', key, detail });

  const btcCode = btcErrorCode(e);
  if (btcCode) {
    const detail = btcCode === 'BTC_BROADCAST_REJECTED' ? (e as { detail?: string }).detail?.slice(0, 120) : undefined;
    return send(BTC_ERROR_I18N[btcCode], detail || undefined);
  }
  if (msg.includes('no_keystore')) return send('csErrNoWallet');
  if (msg.includes('no_sol_enc')) return send('csErrNoSol');
  if (msg.includes('no_btc_enc')) return send('csErrNoBtc');
  if (msg.includes('no_tron_enc')) return send('csErrNoTron');
  if (msg.includes('no_ton_enc')) return send('csErrNoTon');
  // Только ошибки расшифровки (ethers keystore / aes.ts). Раньше сюда
  // попадало любое 'invalid' (адрес, сумма) → ложное «неверный пароль».
  if (msg.includes('incorrect password') || msg.includes('bad mac') || msg.includes('неверный пароль')) {
    return { field: 'password', key: 'csErrWrongPassword' };
  }
  if (msg.includes('insufficient funds for rent')) return send('csErrSolRent');
  if (msg.includes('insufficient') || msg.includes('not sufficient')) return send('csErrInsufficientFee');
  if (msg.includes('nonce') || msg.includes('replacement')) return send('csErrPendingTx');
  // transactions.ts / tron-tx.ts recipient checks ('Неверный SOL-/TRX-адрес получателя.')
  if (/неверный (sol|trx)-адрес/.test(msg) || msg.includes('has no matching script')) return send('csErrInvalidRecipient');
  // 'Сумма должна быть больше нуля.' (transactions.ts, tron-tx.ts), 'Некорректная сумма.' (display-format.ts)
  if (msg.includes('сумма должна быть больше нуля') || msg.includes('некорректная сумма')) return send('csErrInvalidAmount');
  if (msg.includes('ошибка построения trx')) return send('csErrTronBuild');
  if (msg.includes('ошибка отправки в сеть tron')) return send('csErrTronBroadcast');
  if (msg.includes('trongrid') || (msg.includes('tron') && msg.includes('недоступен'))) return send('csErrTrongridDown');
  if (msg.includes('utxo') || msg.includes('подтверждённых')) return send('csErrNoUtxo');
  if (msg.includes('dust') || msg.includes('546')) return send('csErrDust');
  if (msg.includes('blockhash')) return send('csErrSolanaNetwork');
  if (/\b429\b/.test(msg) || msg.includes('rate limit') || msg.includes('ratelimit')) return send('csErrNetworkBusy');
  return send('csErrGeneric', raw.slice(0, 100));
}

/** Клавиатура: скрывать по тапу вне текстового поля (mobile WebView). */
function blurOnOutsideTap(e: React.PointerEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('input,textarea')) {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
}

interface CryptoSendScreenProps {
  initialCoin?:  Coin;
  initialAddress?: string;
  initialAmount?: string;
  recipientName?: string;
  neuroId?: string;
  onAvatarState?: (s: 'idle' | 'talking' | 'thinking') => void;
}

export const CryptoSendScreen: React.FC<CryptoSendScreenProps> = ({
  initialCoin = 'ETH',
  initialAddress = '',
  initialAmount = '',
  recipientName = '',
  neuroId = '',
  onAvatarState,
}) => {
  const { isDemo } = useAuth();
  const { t, lang } = useLanguage();
  const numLocale = lang === 'en' ? 'en-US' : 'ru-RU';
  const { formatFiat } = useDisplayCurrency();
  const [coin,     setCoin]     = useState<Coin>(initialCoin);
  const [address,  setAddress]  = useState('');
  const [resolving,     setResolving]     = useState(false); // ENS/.ton resolve (2.6)
  const [resolvedAlias, setResolvedAlias] = useState('');    // name the address was resolved from
  const [resolveErr,    setResolveErr]    = useState('');
  const [amount,   setAmount]   = useState('');
  const [step,     setStep]     = useState<Step>('form');
  const [password, setPassword] = useState('');
  const [pwError,  setPwError]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [txHash,   setTxHash]   = useState('');
  // Broadcast outcome unknown (lib/crypto/broadcast-error.ts): the tx was
  // signed and handed to the network but no node confirmed receipt. The done
  // screen says so and polls the hash instead of inviting a retry.
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  // Last broadcast transfer on this device (lib/last-send.ts), shown on the
  // form with its live status. Real mode only.
  const [lastSend, setLastSend] = useState<LastSend | null>(null);
  const [sendErr,  setSendErr]  = useState('');
  const [balances, setBalances] = useState<Record<Coin, number>>({ ETH: 0, BTC: 0, SOL: 0, USDT: 0, TRX: 0, TRC20: 0, TON: 0, USDT_TON: 0 });
  const [balReady, setBalReady] = useState(false);
  // Coins whose balance did not load this round (provider down). Their number
  // is a last-known value or 0, so we never claim "insufficient funds" for them.
  const [unknownCoins, setUnknownCoins] = useState<Coin[]>([]);
  const [eurRates, setEurRates] = useState({ eth: 2800, btc: 55000, sol: 120, trx: 0.22, ton: 3.5 });

  // Review-симуляция (задача 1.2)
  const [sim,        setSim]        = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simRetry,   setSimRetry]   = useState(0);
  const traceRef   = useRef('');     // сквозной trace id одного send-флоу
  const draftIdRef = useRef('');     // id серверного tx_draft

  // Риск-оценка получателя (задача 1.3)
  const [risk,           setRisk]           = useState<RiskAssessment | null>(null);
  const [riskOverridden, setRiskOverridden] = useState(false);
  const riskEventIdRef = useRef('');

  // Policy Engine gate on review (задача 3.1) — active only behind the flag.
  const [policyDecision, setPolicyDecision] = useState<PolicyDecision | null>(null);
  const [policyConfirmed, setPolicyConfirmed] = useState(false);

  // Neura explainer на review (задача 1.7)
  const [neuraNote,        setNeuraNote]        = useState('');
  const [neuraNoteLoading, setNeuraNoteLoading] = useState(false);

  const askNeuraAboutDraft = async () => {
    if (neuraNoteLoading) return;
    setNeuraNoteLoading(true);
    setNeuraNote('');
    const reply = await fetchExplanation(
      txFacts({
        chain: coin,
        type: 'out',
        amount: amountNum,
        address: address.trim(),
        date: new Date().toISOString(),
        fee: sim?.feeNative ?? NaN, // NaN → 'unknown' в фактах
      }),
      lang,
    );
    setNeuraNote(reply ?? t('txExplainFailed'));
    setNeuraNoteLoading(false);
  };

  useEffect(() => {
    setCoin(initialCoin);
    setAddress(initialAddress);
    // Same precision rule as typing: the review must show exactly what gets
    // signed (the libs truncate to the chain's decimals). A non-plain decimal
    // (e.g. exponent form) is dropped rather than "sanitized" into another number.
    setAmount(/^\d*\.?\d*$/.test(initialAmount) ? sanitizeAmountInput(initialAmount, COIN_DECIMALS[initialCoin]) : '');
    setStep('form');
    setPassword('');
    setPwError('');
    setSendErr('');
    setTxHash('');
    setOutcomeUnknown(false);
  }, [initialCoin, initialAddress, initialAmount]);

  // Previous transfer banner: read once on mount (real mode only).
  useEffect(() => {
    setLastSend(isDemo ? null : readLastSend());
  }, [isDemo]);

  // Load real balances on mount, then every MARKET_REFRESH_MS. `reloadBalancesRef`
  // lets reset() force a fresh round after a send. A sequence number drops a
  // slower, older round that resolves after a newer one.
  const balancesSeqRef = useRef(0);
  const reloadBalancesRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) {
      // Shared demo dataset — keeps send balances in sync with the portfolio.
      setBalances({
        ETH: DEMO_HOLDING.ETH.amount, BTC: DEMO_HOLDING.BTC.amount, SOL: DEMO_HOLDING.SOL.amount,
        USDT: DEMO_HOLDING.USDT.amount, TRX: DEMO_HOLDING.TRX.amount, TRC20: DEMO_HOLDING.USDT_TRC.amount,
        TON: DEMO_HOLDING.TON.amount, USDT_TON: DEMO_HOLDING.USDT_TON.amount,
      });
      setBalReady(true);
      return;
    }
    const eth  = localStorage.getItem('wallet_eth_address')  || '';
    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';
    if (!eth) {
      reloadBalancesRef.current = () => setBalReady(true);
      setBalReady(true);
      return;
    }
    const loadBalances = () => {
      const seq = ++balancesSeqRef.current;
      fetchRealBalances(eth, sol, btc, tron, ton)
        .then((b) => {
          if (seq !== balancesSeqRef.current) return;
          setBalances({ ETH: b.eth, BTC: b.btc, SOL: b.sol, USDT: b.usdt, TRX: b.trx, TRC20: b.usdtTrc, TON: b.ton, USDT_TON: b.usdtTon });
          setUnknownCoins((b.unavailable ?? []).map((a) => (a === 'USDT_TRC' ? 'TRC20' : a) as Coin));
          setEurRates({ eth: b.ethEur, btc: b.btcEur, sol: b.solEur, trx: b.trxEur, ton: b.tonEur });
          setBalReady(true);
        })
        .catch(() => {
          if (seq !== balancesSeqRef.current) return;
          // Nothing loaded this round: the numbers on screen are old, so no
          // coin's balance is known (never claim sufficient/insufficient on them).
          setUnknownCoins(ALL_COINS);
          setBalReady(true);
        });
    };

    reloadBalancesRef.current = loadBalances;
    loadBalances();
    const timer = window.setInterval(loadBalances, MARKET_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      reloadBalancesRef.current = () => {};
      balancesSeqRef.current += 1; // results of rounds still in flight are dropped
    };
  }, [isDemo]);

  const data       = COINS[coin];
  const amountNum  = parseFloat(amount) || 0;
  // Shown to the user: the typed decimal string, never JS number formatting (1e-7).
  const displayAmount = amount.replace(/\.$/, '').replace(/^\./, '0.') || '0';
  const available  = balances[coin];
  const balanceUnknown = !isDemo && unknownCoins.includes(coin);
  const insufficient = !balanceUnknown && amountNum > 0 && amountNum > available;

  // ── Post-send on-chain status (done screen) ──────────────────────────────
  // Broadcast ≠ success: a USDT TRC-20 transfer can fail with OUT_OF_ENERGY
  // (TRX burned), a SOL tx can expire. Read-only polling; demo never polls.
  // One poller serves both the done screen (this send) and, on the form, the
  // previous-transfer banner (lib/last-send.ts). Done → "new transfer" keeps
  // the same hash, so the status carries over without a restart.
  const statusEnabled = step === 'done' && !isDemo && data.implemented && !!txHash;
  const bannerStatusEnabled = step === 'form' && !isDemo && !!lastSend;
  const polledCoin: Coin = statusEnabled ? coin : bannerStatusEnabled && lastSend ? lastSend.coin : coin;
  const polledHash = statusEnabled ? txHash : bannerStatusEnabled && lastSend ? lastSend.hash : '';
  const pollEnabled = statusEnabled || bannerStatusEnabled;
  const tonStatusWallet = pollEnabled && (polledCoin === 'TON' || polledCoin === 'USDT_TON')
    ? localStorage.getItem('wallet_ton_address') ?? undefined
    : undefined;
  const txStatus = useTxStatus({ coin: polledCoin, hash: polledHash, enabled: pollEnabled, tonWalletAddress: tonStatusWallet });

  const statusTrackedRef = useRef('');
  useEffect(() => {
    if (!statusEnabled || (txStatus.state !== 'confirmed' && txStatus.state !== 'failed')) return;
    const key = `${txHash}:${txStatus.state}`;
    if (statusTrackedRef.current === key) return;
    statusTrackedRef.current = key;
    track(txStatus.state === 'confirmed' ? 'send_confirmed' : 'send_failed_onchain', { coin }, traceRef.current || undefined);
  }, [statusEnabled, txStatus.state, txHash, coin]);

  // MAX: для нативной монеты (комиссия платится ею же) резервируем оценку
  // комиссии, иначе review всегда блокирует «недостаточно средств».
  const [maxLoading, setMaxLoading] = useState(false);
  const handleMax = async () => {
    const decimals = COIN_DECIMALS[coin];
    if (isDemo || FEE_CURRENCY[coin].coin !== coin) {
      setAmount(amountToDecimalString(available, decimals));
      return;
    }
    setMaxLoading(true);
    try {
      const fee = await estimateFeeNative({
        coin,
        amount: available,
        fromBtcAddress: localStorage.getItem('wallet_btc_address') ?? undefined,
      });
      // SOL: резерв ровно на комиссию, чтобы остаток был 0, а не «ниже rent-exempt».
      const reserve = coin === 'SOL' ? fee : fee * 1.1;
      const max = Math.max(0, available - reserve);
      setAmount(max > 0 ? amountToDecimalString(max, decimals) : '');
    } catch {
      setAmount(amountToDecimalString(available, decimals)); // review покажет нехватку на комиссию
    } finally {
      setMaxLoading(false);
    }
  };

  // ── Review-симуляция при входе на confirm-шаг (реальный режим) ──────────
  useEffect(() => {
    if (step !== 'confirm' || isDemo || !data.implemented) return;
    if (!traceRef.current) traceRef.current = newTraceId();
    let cancelled = false;

    (async () => {
      setSim(null);
      setRisk(null);
      setRiskOverridden(false);
      setPolicyDecision(null);
      setPolicyConfirmed(false);
      setNeuraNote('');
      setSimLoading(true);

      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token ?? '';

      // История получателей для risk engine — деградирует в [] без миграции.
      const fetchHistory = async (): Promise<string[]> => {
        if (!token) return [];
        try {
          const r = await fetch(`/api/recipient-history?coin=${coin}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const b = await r.json().catch(() => null);
          return Array.isArray(b?.addresses) ? b.addresses : [];
        } catch {
          return [];
        }
      };

      const [result, history] = await Promise.all([
        simulateTransfer({
          coin,
          toAddress: address.trim(),
          amount: amountNum,
          balances,
          eurRates,
          fromBtcAddress: localStorage.getItem('wallet_btc_address') ?? undefined,
          unknownBalances: unknownCoins,
        }),
        fetchHistory(),
      ]);
      if (cancelled) return;

      const assessment = assessRecipient({ coin, toAddress: address.trim(), history });
      setSim(result);
      setRisk(assessment);
      setSimLoading(false);

      // Policy Engine (задача 3.1) — evaluate the send against the user's
      // policies. Behind the flag: when off, policyDecision stays null and the
      // send flow is unchanged. Best-effort: never blocks on an error.
      if (policyEngineEnabled()) {
        try {
          const pols = await fetchPolicies();
          if (!cancelled) {
            setPolicyDecision(
              evaluateSend(pols, {
                coin,
                displayAmount: amountNum,
                recipient: address.trim(),
                network: coin,
                recipientIsFirstTime: !history.includes(address.trim()),
              }),
            );
          }
        } catch {
          /* best-effort — no policy gate on error */
        }
      }

      track('send_review_shown', { coin }, traceRef.current);
      if (isBlocked(result)) {
        const reason = result.warnings.find((w) => w.level === 'block')?.code ?? 'unknown';
        track('send_review_blocked', { coin, reason_code: reason }, traceRef.current);
      }
      if (assessment.level !== 'ok') {
        track('risk_flagged', { coin, level: assessment.level, reason_code: assessment.reasons[0]?.code ?? 'unknown' }, traceRef.current);
      }

      // Серверный драфт (метрики preview-coverage + сырьё для 1.3/1.4).
      // Fire-and-forget: сбой записи никогда не блокирует отправку.
      if (!token) return;
      try {
        const res = await fetch('/api/tx-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-trace-id': traceRef.current },
          body: JSON.stringify({
            coin,
            to_address: address.trim(),
            amount: amountNum,
            simulation: {
              status: result.status,
              fee_native: result.feeNative,
              fee_currency: result.feeCurrency,
              fee_eur: result.feeEur,
              warnings: result.warnings,
            },
          }),
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.id) draftIdRef.current = body.id;
      } catch { /* драфт не критичен */ }

      // Риск-событие (warning/block) — тоже fire-and-forget.
      if (assessment.level !== 'ok') {
        try {
          const r = await fetch('/api/risk-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-trace-id': traceRef.current },
            body: JSON.stringify({
              coin,
              level: assessment.level,
              reasons: assessment.reasons,
              draft_id: draftIdRef.current || undefined,
            }),
          });
          const b = await r.json().catch(() => null);
          if (b?.id) riskEventIdRef.current = b.id;
        } catch { /* не критично */ }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, simRetry]);

  /** Финализация драфта после попытки отправки — fire-and-forget. */
  const finalizeDraft = (status: 'sent' | 'failed', hash?: string) => {
    const id = draftIdRef.current;
    if (!id) return;
    void (async () => {
      try {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        if (!token) return;
        await fetch('/api/tx-draft', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-trace-id': traceRef.current },
          body: JSON.stringify({ id, status, tx_hash: hash }),
        });
      } catch { /* не критично */ }
    })();
  };

  const WARNING_I18N: Record<SimWarning['code'], Parameters<typeof t>[0]> = {
    invalid_address: 'csWarnInvalidAddress',
    invalid_amount: 'csWarnInvalidAmount',
    insufficient_funds: 'csWarnInsufficientFunds',
    insufficient_fee_balance: 'csWarnFeeBalance',
    simulation_timeout: 'csWarnSimTimeout',
    simulation_failed: 'csWarnSimFailed',
    balance_unknown: 'csWarnBalanceUnknown',
  };

  const addressValid =
    coin === 'ETH' || coin === 'USDT'           ? isValidEthAddress(address.trim())
    : coin === 'SOL'                             ? isValidSolAddress(address.trim())
    : coin === 'TRX' || coin === 'TRC20'         ? isValidTronAddress(address.trim())
    : coin === 'TON' || coin === 'USDT_TON'     ? isValidTonAddress(address.trim())
    : isValidBtcAddress(address.trim()); // BTC

  // Name resolution (2.6): TON DNS for TON-family coins (verified working).
  // ENS (.eth) stays gated off here on purpose. The original blocker (the dead
  // cloudflare-eth RPC) is gone: resolveEns now uses lib/crypto/eth-provider.ts
  // and resolves live. Turning it on decides where real money goes, so it is an
  // owner decision after a manual check (see the night audit plan, 2026-10-13).
  const resolvableChain: ResolvableChain | null =
    coin === 'TON' || coin === 'USDT_TON' ? 'ton'
    : null;
  const addressIsName =
    resolvableChain === 'ton' ? looksLikeTonDnsName(address.trim()) : false;

  /**
   * Continue to review. If the input is a resolvable name, resolve it FIRST and
   * put the resolved ADDRESS into state — so the review card shows the address
   * (not the alias) and the same simulation + risk engine run on it. Fail-closed:
   * a null resolution shows an error and stays on the form.
   */
  const handleContinue = async () => {
    setResolveErr('');
    if (addressValid) { setResolvedAlias(''); setStep('confirm'); return; }
    if (addressIsName && resolvableChain) {
      setResolving(true);
      const resolved = await resolveName(address.trim(), resolvableChain);
      setResolving(false);
      if (!resolved) { setResolveErr(t('csResolveFailed')); return; }
      setResolvedAlias(address.trim());
      setAddress(resolved); // review + risk + simulation run on the resolved address
      setStep('confirm');
    }
  };

  /** Осознанный override блокирующего риска — фиксация в БД и audit. */
  const confirmRiskOverride = () => {
    track('risk_override', { coin, reason_code: risk?.reasons[0]?.code ?? 'unknown' }, traceRef.current);
    const id = riskEventIdRef.current;
    if (!id) return;
    void (async () => {
      try {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        if (!token) return;
        await fetch('/api/risk-event', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-trace-id': traceRef.current },
          body: JSON.stringify({ id }),
        });
      } catch { /* не критично */ }
    })();
  };

  const reset = () => {
    traceRef.current = '';
    draftIdRef.current = '';
    riskEventIdRef.current = '';
    setSim(null);
    setRisk(null);
    setRiskOverridden(false);
    setStep('form');
    setAddress('');
    setResolvedAlias('');
    setResolveErr('');
    setResolving(false);
    setAmount('');
    setPassword('');
    setPwError('');
    setSendErr('');
    setTxHash('');
    setOutcomeUnknown(false);
    if (!isDemo) {
      // The transfer just sent is not in the numbers on screen: the shared
      // balance cache (10 s) and the 30 s poll would let a second transfer
      // exceed the real balance. Drop the cache and keep Continue disabled
      // until a fresh round has loaded.
      resetSharedBalances();
      setBalReady(false);
      reloadBalancesRef.current();
      setLastSend(readLastSend());
    }
  };

  /**
   * Best-effort Telegram notice in the /api/tg-notify contract:
   * { kind: 'tx_sent', coin, amount, to, hash, lang }. `amount` is the decimal
   * string the user typed (never String(number): 1e-7 fails validation). If a
   * field does not fit the server format, the notice is skipped. Never throws.
   */
  const notifyTelegramTxSent = async (hash: string, traceId: string) => {
    try {
      if (!localStorage.getItem('tg_user_id')) return;
      const body = buildTxSentNotice({ coin, amount, to: address.trim(), hash, lang });
      if (!body) return;
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) return;
      await postTxSentNotice(body, token, traceId);
    } catch { /* уведомление не критично */ }
  };

  // ─── Send (all chains) ────────────────────────────────────────────────────
  // Re-entrancy guard: decrypting takes seconds (scrypt N=2^17) while the UI
  // stays responsive, so a double Enter / key repeat / double tap used to start
  // parallel sends (two distinct TRX / USDT TRC-20 transfers). The ref is set
  // synchronously, before any await, and cleared only when the attempt ends.
  // The ref only covers this instance; the app-wide lib/send-lock.ts also
  // stops a second instance (screen left and reopened mid-send) and lets the
  // wallet shell disable navigation until the attempt ends.
  const sendInFlightRef = useRef(false);
  const handleConfirmSend = async () => {
    if (sendInFlightRef.current) return;
    if (!sendLock.acquire()) {
      setSendErr(t('csSendInProgress'));
      return;
    }
    sendInFlightRef.current = true;
    try {
      await confirmSendOnce();
    } finally {
      sendInFlightRef.current = false;
      sendLock.release();
    }
  };

  const confirmSendOnce = async () => {
    if (isDemo || !data.implemented) {
      // Placeholder for BTC/SOL/USDT — show success screen (no real tx)
      setTxHash(`demo-${coin.toLowerCase()}-${Date.now().toString(36)}`);
      onAvatarState?.('talking');
      setStep('done');
      setTimeout(() => onAvatarState?.('idle'), 3000);
      if (isDemo) completeDemoTask('demo_send'); // воронка 1.8; chain-действий здесь нет
      return;
    }

    // Policy Engine gate (задача 3.1, flag-gated). Chokepoint defense: a denied
    // action can never proceed; a confirm-required action needs the checkbox.
    if (policyEngineEnabled() && policyDecision) {
      if (policyDecision.effect === 'deny') {
        setSendErr(policyDecision.reasons[0]?.message ?? 'Blocked by your policies.');
        return;
      }
      if (policyDecision.effect === 'confirm' && !policyConfirmed) {
        setSendErr(policyDecision.reasons[0]?.message ?? 'Please confirm the policy notice.');
        return;
      }
    }

    // ETH — require password
    setSending(true);
    setPwError('');
    setSendErr('');

    // Сквозной trace id флоу: создан при входе на review-шаг, тот же uuid
    // лежит в tx_drafts.trace_id, analytics_events и audit_log.
    const traceId = traceRef.current || newTraceId();
    track('send_initiated', { coin }, traceId);

    try {
      const keystore = localStorage.getItem('wallet_keystore');
      if (!keystore) throw new Error('NO_KEYSTORE');

      onAvatarState?.('thinking');
      let hash: string;

      if (coin === 'SOL') {
        const solEnc = localStorage.getItem('wallet_sol_enc');
        if (!solEnc) throw new Error('NO_SOL_ENC');
        hash = await sendSol(solEnc, password, address.trim(), amountNum);
      } else if (coin === 'BTC') {
        const btcEnc  = localStorage.getItem('wallet_btc_enc');
        const btcAddr = localStorage.getItem('wallet_btc_address');
        if (!btcEnc)  throw new Error('NO_BTC_ENC');
        if (!btcAddr) throw new Error('NO_KEYSTORE');
        // Sign at the fee rate the review showed (sendBtc refuses > cap or a fee
        // above half the amount); without a reviewed rate it fetches one, capped.
        hash = await sendBtc(btcEnc, password, address.trim(), amountNum, btcAddr, {
          feeRateSatVb: sim?.btcFeeRateSatVb,
        });
      } else if (coin === 'USDT') {
        hash = await sendUsdt(keystore, password, address.trim(), amountNum);
      } else if (coin === 'TRC20') {
        const tronEnc = localStorage.getItem('wallet_tron_enc');
        if (!tronEnc) throw new Error('NO_TRON_ENC');
        hash = await sendUsdtTrc20(tronEnc, password, address.trim(), amountNum);
      } else if (coin === 'TRX') {
        const tronEnc = localStorage.getItem('wallet_tron_enc');
        if (!tronEnc) throw new Error('NO_TRON_ENC');
        hash = await sendTrx(tronEnc, password, address.trim(), amountNum);
      } else if (coin === 'TON') {
        const tonEnc = localStorage.getItem('wallet_ton_enc');
        if (!tonEnc) throw new Error('NO_TON_ENC');
        hash = await sendTon(tonEnc, password, address.trim(), amountNum);
      } else if (coin === 'USDT_TON') {
        const tonEnc = localStorage.getItem('wallet_ton_enc');
        if (!tonEnc) throw new Error('NO_TON_ENC');
        hash = await sendUsdtTon(tonEnc, password, address.trim(), amountNum);
      } else {
        // ETH
        hash = await sendEth(keystore, password, address.trim(), amountNum);
      }
      // Remember it first: if the app is closed or the screen reopened, the
      // form shows this transfer and its status before anything is resent.
      recordLastSend({ coin, hash, amount: displayAmount, to: address.trim() });
      setTxHash(hash);
      setOutcomeUnknown(false);
      setStep('done');
      onAvatarState?.('talking');
      setTimeout(() => onAvatarState?.('idle'), 4000);

      track('send_succeeded', { coin }, traceId);
      trackOnce('analytics_first_send', 'first_send_succeeded', { coin }, traceId);
      finalizeDraft('sent', hash);

      // In-app inbox (2.4) — best-effort, never blocks the send. Not in demo
      // (isDemo returns earlier). Server composes the text; only coin is sent.
      void emitNotification('tx_sent', { coin, lang, traceId });

      // One-time migration: the password is proven correct by the successful
      // send, so re-encrypt a legacy scrypt N=8192 keystore with N=131072.
      // Fire-and-forget — never blocks or breaks the send flow.
      void upgradeStoredKeystoreIfWeak(password);

      // Telegram push (only for Telegram logins). The server composes the text
      // from validated fields; detached so nothing here can reach the catch
      // below and report an already broadcast transfer as failed.
      void notifyTelegramTxSent(hash, traceId);
    } catch (e: unknown) {
      if (isBroadcastOutcomeUnknown(e)) {
        // Signed and handed to the network, but no node confirmed receipt.
        // NOT an error: a retry would be a second, different transfer. Show
        // the done screen in the "don't resend" state and poll the hash.
        // Analytics: no new event (server allowlist), send_failed + reason.
        track('send_failed', { coin, reason_code: 'outcome_unknown' }, traceId);
        // Draft keeps the hash for reconciliation; 'sent' = handed to the network.
        finalizeDraft('sent', e.hash || undefined);
        recordLastSend({ coin, hash: e.hash, amount: displayAmount, to: address.trim() });
        setTxHash(e.hash);
        setOutcomeUnknown(true);
        setStep('done');
        onAvatarState?.('idle');
        return;
      }
      track('send_failed', { coin }, traceId);
      finalizeDraft('failed');
      const view = describeSendError(e);
      const text = t(view.key).replace('{cap}', String(BTC_MAX_FEE_RATE_SAT_VB));
      if (view.field === 'password') {
        setPwError(text);
      } else if (view.key === 'csErrGeneric') {
        // Unmapped error: show the lib text only if it is readable in the UI
        // language (lib messages are partly Russian).
        const detail = view.detail ?? '';
        const readable = detail && !(lang === 'en' && /[А-Яа-яЁё]/.test(detail));
        setSendErr(readable ? `${text} ${detail}` : t('csErrGenericRetry'));
      } else {
        setSendErr(view.detail ? `${text} ${view.detail}` : text);
      }
      onAvatarState?.('idle');
    } finally {
      setSending(false);
    }
  };

  // ─── Done screen ──────────────────────────────────────────────────────────
  if (step === 'done') {
    const shortHash = txHash ? `${txHash.slice(0, 10)}…${txHash.slice(-6)}` : null;
    const failedOnchain = statusEnabled && txStatus.state === 'failed';
    const isTonFamily = coin === 'TON' || coin === 'USDT_TON';
    const isTron = coin === 'TRX' || coin === 'TRC20';

    const failReasonText = (reason?: string): string => {
      if (reason === 'OUT_OF_ENERGY') return t('csStatusReasonOutOfEnergy');
      if (reason === 'REVERT' || reason === TX_STATUS_REASON.ETH_REVERTED) return t('csStatusReasonRevert');
      if (reason === TX_STATUS_REASON.SOL_ERROR) return t('csStatusReasonSol');
      return t('csStatusReasonCode').replace('{code}', reason || 'FAILED');
    };

    // Status line under the title. Honest TON wording: seqno moved = the wallet
    // contract processed the message, not proof the jetton arrived.
    const statusLine: { text: string; color: string; note?: string } | null = !statusEnabled
      ? null
      : txStatus.state === 'confirmed'
        ? {
            text: isTonFamily ? t('csStatusProcessed') : t('csStatusConfirmed'),
            color: '#00FF7F',
            note: coin === 'USDT_TON' ? t('csStatusUsdtTonNote') : undefined,
          }
        : txStatus.state === 'failed'
          ? {
              text: t('csStatusFailed').replace('{reason}', failReasonText(txStatus.reason)),
              color: '#FF5252',
              note: isTron ? t('csStatusTronFeeSpent') : undefined,
            }
          : txStatus.state === 'unknown'
            ? {
                text: t('csStatusUnknown'),
                color: '#F7931A',
                note: txStatus.reason === TX_STATUS_REASON.SOL_MAYBE_EXPIRED ? t('csStatusSolExpired')
                  : txStatus.reason === TX_STATUS_REASON.BTC_NOT_FOUND ? t('csStatusNotFound')
                  : t('csStatusCheckExplorer'),
              }
            : {
                text: t('csStatusPending'),
                color: '#F7931A',
                note: txStatus.timedOut ? t('csStatusStopped') : undefined,
              };

    // Outcome unknown: keep the warning until polling settles it. Confirmed →
    // the normal success view; failed → the failed view; still open when
    // polling ends (or no hash to poll) → also point to History.
    const outcomeSettled = statusEnabled && (txStatus.state === 'confirmed' || txStatus.state === 'failed');
    const unknownOpen = outcomeUnknown && !outcomeSettled;
    const unknownStuck = unknownOpen && (!statusEnabled || txStatus.state === 'unknown' || txStatus.timedOut);

    const accent = failedOnchain ? '#FF5252' : unknownOpen ? '#F7931A' : data.color;
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center gap-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: failedOnchain ? 'rgba(255,82,82,0.12)' : unknownOpen ? 'rgba(247,147,26,0.12)' : data.bgColor,
            border: `2px solid ${accent}`,
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={accent}
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {failedOnchain
              ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              : unknownOpen
                ? <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></>
                : <polyline points="20 6 9 17 4 12"/>}
          </svg>
        </div>

        <div data-testid={unknownOpen ? 'send-outcome-unknown' : undefined}>
          <p className="text-white text-xl font-bold">
            {failedOnchain
              ? t('csStatusFailedTitle')
              : unknownOpen
                ? t('csOutcomeUnknownTitle')
                : t('csSent').replace('{amt}', displayAmount).replace('{coin}', coinLabel(coin))}
          </p>
          {unknownOpen ? (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: '#F7931A' }}>
              {t('csOutcomeUnknownText')}
            </p>
          ) : (
            <p className="text-[#3A6045] text-sm mt-1">
              {`${recipientName ? `${recipientName} • ` : ''}${isDemo ? t('csTxSentDemo') : t('csTxSentToNetwork')}`}
            </p>
          )}
          {statusLine && (
            <div className="mt-3" role="status" aria-live="polite">
              <p className="text-sm font-semibold" style={{ color: statusLine.color }}>{statusLine.text}</p>
              {statusLine.note && (
                <p className="text-xs mt-1 text-[#7FBF9A] leading-relaxed">{statusLine.note}</p>
              )}
            </div>
          )}
          {unknownStuck && (
            <p className="text-xs mt-2 leading-relaxed" style={{ color: '#F7931A' }}>
              {t('csOutcomeUnknownCheckHistory')}
            </p>
          )}
        </div>

        {txHash && (
          <div
            className="w-full rounded-2xl p-4 text-left"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
          >
            <p className="text-[#3A6045] text-xs mb-1">TX Hash</p>
            <p className="text-white text-xs font-mono break-all">{shortHash}</p>
            {/* Demo tx hashes are fake — an explorer link would 404, so hide it. */}
            {!isDemo && (
              <a
                href={explorerTxUrl(coin, txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-semibold"
                style={{ color: '#00FF7F' }}
              >
                {t(explorerLabelKey(coin))}
              </a>
            )}
          </div>
        )}

        {/* The Neura notes describe a sent transfer: not while the outcome is open. */}
        {!unknownOpen && (
          <div
            className="w-full rounded-2xl p-3.5"
            style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.12)' }}
          >
            <p className="text-[#00FF7F] text-xs font-semibold mb-1">{t('navNeura')}</p>
            <p className="text-white text-xs leading-relaxed">
              {failedOnchain
                ? t('csNeuraFailedOnchain')
                : txHash
                ? coin === 'TRX'
                  ? t('csNeuraDoneTrx')
                  : coin === 'TRC20'
                  ? t('csNeuraDoneTrc20')
                  : coin === 'USDT'
                  ? t('csNeuraDoneUsdt')
                  : coin === 'BTC'
                  ? t('csNeuraDoneBtc')
                  : coin === 'SOL'
                  ? t('csNeuraDoneSol')
                  : coin === 'TON'
                  ? t('csNeuraDoneTon')
                  : coin === 'USDT_TON'
                  ? t('csNeuraDoneUsdtTon')
                  : t('csNeuraDoneEth')
                : t('csNeuraDoneFallback')}
            </p>
          </div>
        )}

        <button
          onClick={reset}
          className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1.5px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
        >
          {t('csNewTransaction')}
        </button>
      </div>
    );
  }

  // ─── Password step (ETH only) ─────────────────────────────────────────────
  if (step === 'password') {
    const shortAddr = address.length > 16
      ? `${address.slice(0, 10)}…${address.slice(-6)}`
      : address;

    return (
      <div className="px-6 pt-2 flex flex-col gap-5" onPointerDown={blurOnOutsideTap}>
        <h2 className="text-white text-lg font-bold">{t('csEnterWalletPassword')}</h2>

        <div
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.10)' }}
        >
          <div className="flex justify-between text-xs">
            <span className="text-[#3A6045]">{t('csYouSend')}</span>
            <span className="text-white font-bold">{displayAmount} {coinLabel(coin)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#3A6045]">{t('csToAddress')}</span>
            <span className="text-white font-mono">{shortAddr}</span>
          </div>
          {recipientName && (
            <div className="flex justify-between text-xs">
              <span className="text-[#3A6045]">{t('csRecipientField')}</span>
              <span className="text-white font-medium">{recipientName}</span>
            </div>
          )}
          {neuroId && (
            <div className="flex justify-between text-xs">
              <span className="text-[#3A6045]">NeuroID</span>
              <span className="text-[#00FF7F] font-mono">{neuroId}</span>
            </div>
          )}
        </div>

        <div>
          <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">
            {t('csPasswordForSigning')}
          </p>
          <div
            className="rounded-2xl px-4 py-3.5"
            style={{
              background: '#0D1A10',
              border: `1px solid ${pwError ? 'rgba(255,82,82,0.5)' : 'rgba(0,255,127,0.12)'}`,
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password && !sending && !e.repeat) void handleConfirmSend();
              }}
              disabled={sending}
              placeholder={t('csPasswordPlaceholder')}
              className="w-full bg-transparent text-white text-sm outline-none placeholder:text-[#3A6045] disabled:opacity-50"
              style={{ caretColor: '#00FF7F' }}
            />
          </div>
          {pwError && (
            <p className="text-xs mt-1.5" style={{ color: '#FF5252' }}>{pwError}</p>
          )}
        </div>

        {sendErr && (
          <div
            className="rounded-2xl p-3.5"
            style={{ background: 'rgba(255,82,82,0.06)', border: '1px solid rgba(255,82,82,0.25)' }}
          >
            <p className="text-xs" style={{ color: '#FF5252' }}>{sendErr}</p>
          </div>
        )}

        <div
          className="rounded-2xl p-3.5"
          style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.1)' }}
        >
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">{t('navNeura')}</p>
          <p className="text-[#3A6045] text-xs leading-relaxed">
            {t('csNeuraPrivacyNote')}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => { setStep('confirm'); setPwError(''); setSendErr(''); }}
            disabled={sending}
            className="flex-1 py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'transparent', border: '1.5px solid rgba(0,255,127,0.15)', color: '#3A6045' }}
          >
            {t('csBack')}
          </button>
          <button
            onClick={handleConfirmSend}
            disabled={!password || sending}
            className="flex-1 py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09' }}
          >
            {sending
              ? <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#080C09" strokeWidth="2.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                  {t('csSending')}
                </span>
              : t('csConfirmAndSend')}
          </button>
        </div>
      </div>
    );
  }

  // ─── Confirm step (review card, задача 1.2) ───────────────────────────────
  if (step === 'confirm') {
    const shortAddr = address.length > 16
      ? `${address.slice(0, 10)}…${address.slice(-6)}`
      : address;

    const realReview = data.implemented && !isDemo;
    const simBlocked = realReview && sim !== null && isBlocked(sim);
    const riskBlocked = realReview && risk !== null && risk.level === 'block' && (!risk.overridable || !riskOverridden);
    const policyActive = realReview && policyEngineEnabled() && policyDecision !== null;
    const policyBlocked = policyActive && policyDecision!.effect === 'deny';
    const policyNeedsConfirm = policyActive && policyDecision!.effect === 'confirm' && !policyConfirmed;
    const confirmDisabled = realReview && (simLoading || simBlocked || riskBlocked || policyBlocked || policyNeedsConfirm);

    const SHIELD: Record<'ok' | 'warning' | 'block', { icon: string; color: string; bg: string; border: string }> = {
      ok:      { icon: '🛡', color: '#00FF7F', bg: 'rgba(0,255,127,0.05)',  border: 'rgba(0,255,127,0.2)' },
      warning: { icon: '🛡', color: '#F7931A', bg: 'rgba(247,147,26,0.06)', border: 'rgba(247,147,26,0.25)' },
      block:   { icon: '🛡', color: '#FF453A', bg: 'rgba(255,59,48,0.08)',  border: 'rgba(255,59,48,0.35)' },
    };
    const RISK_I18N: Record<string, Parameters<typeof t>[0]> = {
      known_recipient: 'csRiskKnown',
      first_seen: 'csRiskFirstSeen',
      poisoning_similarity: 'csRiskPoisoning',
      blocklisted: 'csRiskBlocklisted',
    };

    const fmtAmount = (v: number) =>
      v >= 1 ? v.toFixed(4).replace(/\.?0+$/, '') : v.toPrecision(3);

    const feeNode = !realReview
      ? <span key="f" className="text-[#3A6045]">{formatFeeEstimate(coin, formatFiat)}</span>
      : simLoading
        ? <span key="f" className="text-[#3A6045] animate-pulse">{t('csSimulating')}</span>
        : sim?.feeNative != null
          ? <span key="f" className="text-white">
              ≈ {fmtAmount(sim.feeNative)} {sim.feeCurrency}
              {sim.feeEur != null ? ` (${formatFiat(sim.feeEur)})` : ''}
            </span>
          : <span key="f" style={{ color: '#F7931A' }}>{t('csFeeUnknown')}</span>;

    return (
      <div className="px-6 pt-2 flex flex-col gap-4" onPointerDown={blurOnOutsideTap}>
        <h2 className="text-white text-lg font-bold">{t('csConfirmTitle')}</h2>

        <div
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
        >
          {([
            [t('csCoin'),   <span key="c" className="flex items-center gap-1.5"><span className="font-bold" style={{ color: data.color }}>{data.icon}</span><span className="text-white">{coinLabel(coin)}</span></span>],
            [t('csAmount'),    <span key="a" className="text-white font-bold">{displayAmount} {coinLabel(coin)}</span>],
            [t('csFee'), feeNode],
            ...(realReview && sim?.balanceAfter != null
              ? [[t('csBalanceAfter'), <span key="ba" className="text-white">{fmtAmount(sim.balanceAfter)} {coinLabel(coin)}</span>]] as [string, React.ReactNode][]
              : []),
            ...(recipientName ? [[t('csRecipient'), <span key="r" className="text-white font-medium">{recipientName}</span>]] as [string, React.ReactNode][] : []),
            ...(neuroId ? [['NeuroID', <span key="n" className="text-[#00FF7F] font-mono">{neuroId}</span>]] as [string, React.ReactNode][] : []),
          ] as [string, React.ReactNode][]).map(([label, val]) => (
            <div key={label} className="flex justify-between items-center">
              <span className="text-[#3A6045] text-sm">{label}</span>
              <span className="text-sm">{val}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(0,255,127,0.08)', paddingTop: '12px' }}>
            <p className="text-[#3A6045] text-xs mb-1">{t('csRecipientAddressLabel')}</p>
            {resolvedAlias && (
              <p className="text-[#00FF7F] text-[10px] mb-0.5">{resolvedAlias} → {t('csResolvedTo')}</p>
            )}
            <p className="text-white text-xs font-mono break-all">{address}</p>
          </div>
        </div>

        <div
          className="rounded-2xl p-3.5"
          style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.12)' }}
        >
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">{t('navNeura')}</p>
          <p className="text-white text-xs leading-relaxed">
            {t('csNeuraAddressWarning')}{' '}
            <span className="font-mono">{shortAddr}</span>
          </p>
        </div>

        {/* Shield риск-оценки получателя (задача 1.3) */}
        {realReview && risk !== null && (
          <div
            className="rounded-2xl p-3.5"
            style={{ background: SHIELD[risk.level].bg, border: `1px solid ${SHIELD[risk.level].border}` }}
          >
            {risk.reasons.map((r) => (
              <p key={r.code} className="text-xs leading-relaxed" style={{ color: SHIELD[risk.level].color }}>
                {SHIELD[risk.level].icon}{' '}
                {t(RISK_I18N[r.code]).replace('{addr}', r.similarTo ?? '')}
              </p>
            ))}
            {risk.level === 'block' && risk.overridable && (
              <label className="flex items-start gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={riskOverridden}
                  onChange={(e) => setRiskOverridden(e.target.checked)}
                  className="mt-0.5 accent-[#FF453A]"
                />
                <span className="text-xs text-white leading-relaxed">{t('csRiskOverrideLabel')}</span>
              </label>
            )}
          </div>
        )}

        {/* Policy Engine banner (задача 3.1) — only when the flag is on */}
        {policyActive && policyDecision!.effect !== 'allow' && (
          <div
            className="rounded-xl p-3 flex flex-col gap-1.5"
            style={{
              background: policyBlocked ? 'rgba(255,59,48,0.08)' : 'rgba(247,147,26,0.06)',
              border: `1px solid ${policyBlocked ? 'rgba(255,59,48,0.35)' : 'rgba(247,147,26,0.25)'}`,
            }}
          >
            <span className="text-xs font-semibold" style={{ color: policyBlocked ? '#FF453A' : '#F7931A' }}>
              {policyBlocked ? '⛔ ' : '⚠️ '}
              {lang === 'en' ? 'Security policy' : 'Политика безопасности'}
            </span>
            {policyDecision!.reasons.map((r, i) => (
              <span key={i} className="text-xs text-white leading-relaxed">{r.message}</span>
            ))}
            {policyNeedsConfirm && (
              <label className="flex items-start gap-2 mt-1 cursor-pointer">
                <input type="checkbox" checked={policyConfirmed} onChange={(e) => setPolicyConfirmed(e.target.checked)} className="mt-0.5 accent-[#F7931A]" />
                <span className="text-xs text-white leading-relaxed">{lang === 'en' ? 'I understand, proceed' : 'Понимаю, продолжить'}</span>
              </label>
            )}
          </div>
        )}

        {/* Neura explainer на review-карточке (задача 1.7) */}
        {realReview && (
          <div className="flex flex-col gap-2">
            <button
              onClick={askNeuraAboutDraft}
              disabled={neuraNoteLoading}
              className="py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
              style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.18)', color: '#00FF7F' }}
            >
              {neuraNoteLoading ? t('txExplainLoading') : t('csAskNeura')}
            </button>
            {neuraNote && (
              <div className="rounded-xl p-3 text-xs leading-relaxed" style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.12)' }}>
                <span className="text-[#00FF7F] font-semibold">{t('navNeura')}: </span>
                <span className="text-white">{neuraNote}</span>
              </div>
            )}
          </div>
        )}

        {/* Warnings симуляции: block — красные, warn — оранжевые */}
        {realReview && sim !== null && sim.warnings.map((w) => (
          <div
            key={w.code}
            className="rounded-2xl p-3"
            style={w.level === 'block'
              ? { background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }
              : { background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.2)' }}
          >
            <p className="text-xs" style={{ color: w.level === 'block' ? '#FF453A' : '#F7931A' }}>
              {t(w.detail ? SIM_DETAIL_I18N[w.detail] : WARNING_I18N[w.code])}
            </p>
          </div>
        ))}
        {realReview && sim !== null && (sim.notices ?? []).map((n) => (
          <div
            key={n.detail}
            className="rounded-2xl p-3"
            style={{ background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.2)' }}
          >
            <p className="text-xs" style={{ color: '#F7931A' }}>{t(SIM_DETAIL_I18N[n.detail])}</p>
          </div>
        ))}

        {/* Явный retry при timeout/error симуляции — не тихий пропуск */}
        {realReview && sim !== null && sim.status !== 'ok' && (
          <button
            onClick={() => setSimRetry((n) => n + 1)}
            className="py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{ background: 'rgba(247,147,26,0.1)', border: '1px solid rgba(247,147,26,0.3)', color: '#F7931A' }}
          >
            {t('csSimRetry')}
          </button>
        )}

        {!data.implemented && (
          <div
            className="rounded-2xl p-3"
            style={{ background: 'rgba(247,147,26,0.06)', border: '1px solid rgba(247,147,26,0.2)' }}
          >
            <p className="text-xs" style={{ color: '#F7931A' }}>
              {t('csComingSoonWarning').replace('{coin}', coinLabel(coin))}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="flex-1 py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'transparent', border: '1.5px solid rgba(0,255,127,0.15)', color: '#3A6045' }}
          >
            {t('csBack')}
          </button>
          <button
            onClick={() => {
              if (realReview && risk?.level === 'block' && riskOverridden) confirmRiskOverride();
              if (data.implemented && !isDemo) setStep('password');
              else handleConfirmSend();
            }}
            disabled={confirmDisabled}
            className="flex-1 py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 20px rgba(0,255,127,0.3)' }}
          >
            {realReview && simLoading ? t('csSimulating') : data.implemented && !isDemo ? t('csEnterPassword') : t('csSendDemo')}
          </button>
        </div>
      </div>
    );
  }

  // ─── Form step ────────────────────────────────────────────────────────────
  // Previous transfer (lib/last-send.ts) with its live status: covers leaving
  // the screen or closing the app mid-send, so nobody resends blind.
  const lastSendView = bannerStatusEnabled && lastSend
    ? (() => {
        const tonFamily = lastSend.coin === 'TON' || lastSend.coin === 'USDT_TON';
        const s = txStatus.state;
        const statusKey: TranslationKey = s === 'confirmed'
          ? (tonFamily ? 'csLastSendStatusProcessed' : 'csLastSendStatusConfirmed')
          : s === 'failed' ? 'csLastSendStatusFailed'
          : s === 'unknown' ? 'csLastSendStatusUnknown'
          : 'csLastSendStatusPending';
        const tone = s === 'confirmed'
          ? { bg: 'rgba(0,255,127,0.05)', border: 'rgba(0,255,127,0.2)' }
          : s === 'failed'
            ? { bg: 'rgba(255,82,82,0.06)', border: 'rgba(255,82,82,0.3)' }
            : { bg: 'rgba(247,147,26,0.06)', border: 'rgba(247,147,26,0.3)' };
        const line = t('csLastSendLine')
          .replace('{amt}', lastSend.amount)
          .replace('{coin}', coinLabel(lastSend.coin))
          .replace('{to}', lastSend.to)
          .replace('{status}', t(statusKey));
        return { line, tone };
      })()
    : null;

  return (
    <div className="px-6 pt-2 flex flex-col gap-5" onPointerDown={blurOnOutsideTap}>
      {lastSend && lastSendView && (
        <div
          data-testid="last-send-banner"
          role="status"
          aria-live="polite"
          className="rounded-2xl p-3 flex items-start gap-2"
          style={{ background: lastSendView.tone.bg, border: `1px solid ${lastSendView.tone.border}` }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs leading-relaxed break-words">{lastSendView.line}</p>
            <a
              href={explorerTxUrl(lastSend.coin, lastSend.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-[11px] font-semibold"
              style={{ color: '#00FF7F' }}
            >
              {t(explorerLabelKey(lastSend.coin))}
            </a>
          </div>
          <button
            type="button"
            onClick={() => { dismissLastSend(); setLastSend(null); }}
            aria-label={t('csLastSendDismiss')}
            className="w-7 h-7 -mt-1 -mr-1 flex-shrink-0 rounded-full flex items-center justify-center text-sm transition-all active:scale-90"
            style={{ color: '#7FBF9A' }}
          >
            ✕
          </button>
        </div>
      )}

      <h2 className="text-white text-lg font-bold">{t('csTitle')}</h2>

      {/* Coin selector */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('csCoinLabel')}</p>
        <div className="flex gap-2">
          {([...COIN_PICKER_ORDER] as Coin[]).map((c) => {
            const d = COINS[c];
            return (
              <button
                key={c}
                onClick={() => { setCoin(c); setAmount(''); setAddress(''); }}
                className="flex-1 py-3 rounded-2xl flex flex-col items-center gap-1 transition-all active:scale-95 relative"
                style={{
                  background: coin === c ? d.bgColor : '#0D1A10',
                  border: `1.5px solid ${coin === c ? d.color : 'rgba(0,255,127,0.08)'}`,
                }}
              >
                <span className="text-lg font-bold" style={{ color: d.color }}>{d.icon}</span>
                <span className="text-[10px] font-semibold leading-tight text-center" style={{ color: coin === c ? d.color : '#3A6045' }}>
                  {c === 'USDT' ? 'USDT\nERC-20' : c === 'TRC20' ? 'USDT\nTRC-20' : c === 'USDT_TON' ? 'USDT\nTON' : c}
                </span>
                {!d.implemented && (
                  <span
                    className="absolute -top-1.5 -right-1 text-[8px] font-bold px-1 rounded-full"
                    style={{ background: 'rgba(58,96,69,0.8)', color: '#3A6045' }}
                  >
                    {t('csComingSoonBadge')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[#3A6045] text-xs mt-2">
          {t('csAvailable')}{' '}
          {balReady
            ? <span className="text-white font-medium">{available.toLocaleString(numLocale, { maximumFractionDigits: 6 })} {coinLabel(coin)}</span>
            : <span className="text-[#3A6045]">{t('csLoadingEllipsis')}</span>
          }
        </p>
      </div>

      {/* Address */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('csAddressLabel')}</p>
        <div
          className="rounded-2xl px-4 py-3.5"
          style={{
            background: '#0D1A10',
            border: `1px solid ${address && !addressValid ? 'rgba(255,82,82,0.4)' : 'rgba(0,255,127,0.12)'}`,
          }}
        >
          <input
            type="text"
            value={address}
            onChange={(e) => { setAddress(e.target.value); setResolvedAlias(''); setResolveErr(''); }}
            placeholder={resolvableChain === 'ton' ? `${data.placeholder} ${t('csOrTonName')}` : data.placeholder}
            className="w-full bg-transparent text-white text-sm outline-none placeholder:text-[#3A6045] font-mono"
            style={{ caretColor: '#00FF7F' }}
          />
        </div>
        {/* Invalid only when it's neither a valid address NOR a resolvable name. */}
        {address && !addressValid && !addressIsName && !resolveErr && (
          <p className="text-xs mt-1" style={{ color: '#FF5252' }}>{t('csInvalidAddress')}</p>
        )}
        {addressIsName && !resolveErr && (
          <p className="text-xs mt-1" style={{ color: '#3A6045' }}>{t('csNameWillResolve')}</p>
        )}
        {resolveErr && (
          <p className="text-xs mt-1" style={{ color: '#FF5252' }}>{resolveErr}</p>
        )}
        {/* No memo/comment on TON yet: exchange deposits that need one would be lost. */}
        {(coin === 'TON' || coin === 'USDT_TON') && (
          <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#F7931A' }}>{t('csTonMemoWarning')}</p>
        )}
      </div>

      {/* Amount */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('csAmountLabel')}</p>
        <div
          className="text-center py-5 rounded-2xl"
          style={{
            background: '#0D1A10',
            border: `1px solid ${insufficient ? 'rgba(255,82,82,0.4)' : 'rgba(0,255,127,0.12)'}`,
          }}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold" style={{ color: data.color }}>{data.icon}</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(sanitizeAmountInput(e.target.value, COIN_DECIMALS[coin]))}
              placeholder="0"
              className="text-white text-4xl font-bold bg-transparent outline-none w-32 text-center"
              style={{ caretColor: '#00FF7F' }}
            />
            <span className="text-[#3A6045] text-lg font-bold">{coinLabel(coin)}</span>
          </div>
          {amountNum > 0 && (
            <p className="text-sm mt-1.5">
              {balanceUnknown
                ? <span style={{ color: '#F7931A' }}>{t('csBalanceUnknownInline')}</span>
                : insufficient
                ? <span style={{ color: '#FF5252' }}>{t('csInsufficientFunds')}</span>
                : <span className="text-[#3A6045]">{t('csAvailableInline').replace('{amt}', available.toLocaleString(numLocale, { maximumFractionDigits: 6 })).replace('{coin}', coinLabel(coin))}</span>
              }
            </p>
          )}
          {/* MAX button */}
          {available > 0 && !insufficient && !balanceUnknown && (
            <button
              onClick={() => { void handleMax(); }}
              disabled={maxLoading}
              className="mt-2 text-xs font-semibold px-3 py-1 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(0,255,127,0.08)', color: '#00FF7F' }}
            >
              MAX
            </button>
          )}
        </div>
      </div>

      {/* Real mode: Continue waits for a loaded balance round (after a send,
          reset() forces a fresh one), so the funds check never runs on old numbers. */}
      <button
        onClick={handleContinue}
        disabled={(!addressValid && !addressIsName) || !amountNum || insufficient || resolving || (!isDemo && !balReady)}
        className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
        style={{ background: '#00FF7F', color: '#080C09' }}
      >
        {resolving ? t('csResolving') : t('csContinue')}
      </button>
    </div>
  );
};

export default CryptoSendScreen;
