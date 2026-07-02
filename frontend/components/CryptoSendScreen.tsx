import React, { useState, useEffect, useRef } from 'react';
import { sendEth, sendUsdt, sendUsdtTrc20, sendTrx, sendSol, sendBtc, sendTon, sendUsdtTon, isValidEthAddress, isValidSolAddress, isValidBtcAddress, isValidTronAddress, isValidTonAddress } from '@/lib/crypto/transactions';
import { fetchRealBalances, MARKET_REFRESH_MS } from '@/lib/crypto/balances';
import { upgradeStoredKeystoreIfWeak } from '@/lib/crypto/keystore-migration';
import { track, trackOnce, newTraceId } from '@/lib/analytics';
import { simulateTransfer, isBlocked, type SimulationResult, type SimWarning } from '@/lib/crypto/simulate';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

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

// Estimated fees shown in UI (ETH fee is fetched from chain later)
const FEE_EUR: Record<Coin, string> = {
  ETH: '~€0.30–1.50', BTC: '~€0.50–2.00', SOL: '< €0.01', USDT: '~€0.30', TRX: '< €0.01', TRC20: '< €0.50',
  TON: '~€0.01', USDT_TON: '~€0.05',
};

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
  const [coin,     setCoin]     = useState<Coin>(initialCoin);
  const [address,  setAddress]  = useState('');
  const [amount,   setAmount]   = useState('');
  const [step,     setStep]     = useState<Step>('form');
  const [password, setPassword] = useState('');
  const [pwError,  setPwError]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [txHash,   setTxHash]   = useState('');
  const [sendErr,  setSendErr]  = useState('');
  const [balances, setBalances] = useState<Record<Coin, number>>({ ETH: 0, BTC: 0, SOL: 0, USDT: 0, TRX: 0, TRC20: 0, TON: 0, USDT_TON: 0 });
  const [balReady, setBalReady] = useState(false);
  const [eurRates, setEurRates] = useState({ eth: 2800, btc: 55000, sol: 120, trx: 0.22, ton: 3.5 });

  // Review-симуляция (задача 1.2)
  const [sim,        setSim]        = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simRetry,   setSimRetry]   = useState(0);
  const traceRef   = useRef('');     // сквозной trace id одного send-флоу
  const draftIdRef = useRef('');     // id серверного tx_draft

  useEffect(() => {
    setCoin(initialCoin);
    setAddress(initialAddress);
    setAmount(initialAmount);
    setStep('form');
    setPassword('');
    setPwError('');
    setSendErr('');
    setTxHash('');
  }, [initialCoin, initialAddress, initialAmount]);

  // Load real balances once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) {
      setBalances({ ETH: 1.24, BTC: 0.042, SOL: 12.5, USDT: 110, TRX: 250, TRC20: 85, TON: 32, USDT_TON: 45 });
      setBalReady(true);
      return;
    }
    const eth  = localStorage.getItem('wallet_eth_address')  || '';
    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';
    if (!eth) { setBalReady(true); return; }
    const loadBalances = () => {
      fetchRealBalances(eth, sol, btc, tron, ton)
        .then((b) => {
          setBalances({ ETH: b.eth, BTC: b.btc, SOL: b.sol, USDT: b.usdt, TRX: b.trx, TRC20: b.usdtTrc, TON: b.ton, USDT_TON: b.usdtTon });
          setEurRates({ eth: b.ethEur, btc: b.btcEur, sol: b.solEur, trx: b.trxEur, ton: b.tonEur });
          setBalReady(true);
        })
        .catch(() => setBalReady(true));
    };

    loadBalances();
    const timer = window.setInterval(loadBalances, MARKET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isDemo]);

  const data       = COINS[coin];
  const amountNum  = parseFloat(amount) || 0;
  const available  = balances[coin];
  const insufficient = amountNum > 0 && amountNum > available;

  // ── Review-симуляция при входе на confirm-шаг (реальный режим) ──────────
  useEffect(() => {
    if (step !== 'confirm' || isDemo || !data.implemented) return;
    if (!traceRef.current) traceRef.current = newTraceId();
    let cancelled = false;

    (async () => {
      setSim(null);
      setSimLoading(true);
      const result = await simulateTransfer({
        coin,
        toAddress: address.trim(),
        amount: amountNum,
        balances,
        eurRates,
        fromBtcAddress: localStorage.getItem('wallet_btc_address') ?? undefined,
      });
      if (cancelled) return;
      setSim(result);
      setSimLoading(false);

      track('send_review_shown', { coin }, traceRef.current);
      if (isBlocked(result)) {
        const reason = result.warnings.find((w) => w.level === 'block')?.code ?? 'unknown';
        track('send_review_blocked', { coin, reason_code: reason }, traceRef.current);
      }

      // Серверный драфт (метрики preview-coverage + сырьё для 1.3/1.4).
      // Fire-and-forget: сбой записи никогда не блокирует отправку.
      try {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        if (!token) return;
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
  };

  const addressValid =
    coin === 'ETH' || coin === 'USDT'           ? isValidEthAddress(address.trim())
    : coin === 'SOL'                             ? isValidSolAddress(address.trim())
    : coin === 'TRX' || coin === 'TRC20'         ? isValidTronAddress(address.trim())
    : coin === 'TON' || coin === 'USDT_TON'     ? isValidTonAddress(address.trim())
    : isValidBtcAddress(address.trim()); // BTC

  const reset = () => {
    traceRef.current = '';
    draftIdRef.current = '';
    setSim(null);
    setStep('form');
    setAddress('');
    setAmount('');
    setPassword('');
    setPwError('');
    setSendErr('');
    setTxHash('');
  };

  // ─── Real ETH send ────────────────────────────────────────────────────────
  const handleConfirmSend = async () => {
    if (isDemo || !data.implemented) {
      // Placeholder for BTC/SOL/USDT — show success screen (no real tx)
      setTxHash(`demo-${coin.toLowerCase()}-${Date.now().toString(36)}`);
      onAvatarState?.('talking');
      setStep('done');
      setTimeout(() => onAvatarState?.('idle'), 3000);
      return;
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
        hash = await sendBtc(btcEnc, password, address.trim(), amountNum, btcAddr);
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
      setTxHash(hash);
      setStep('done');
      onAvatarState?.('talking');
      setTimeout(() => onAvatarState?.('idle'), 4000);

      track('send_succeeded', { coin }, traceId);
      trackOnce('analytics_first_send', 'first_send_succeeded', { coin }, traceId);
      finalizeDraft('sent', hash);

      // One-time migration: the password is proven correct by the successful
      // send, so re-encrypt a legacy scrypt N=8192 keystore with N=131072.
      // Fire-and-forget — never blocks or breaks the send flow.
      void upgradeStoredKeystoreIfWeak(password);

      // Push-уведомление в Telegram (если пользователь залогинен через TG)
      const tgId = typeof window !== 'undefined' ? localStorage.getItem('tg_user_id') : null;
      if (tgId) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const coinLabel = coin === 'TRC20' ? 'USDT TRC-20' : coin === 'USDT' ? 'USDT ERC-20' : coin === 'USDT_TON' ? 'USDT TON' : coin;
        const shortAddr = address.trim().slice(0, 6) + '...' + address.trim().slice(-4);
        const msg = lang === 'en'
          ? `✅ <b>Transaction sent</b>\n\n💸 ${amountNum} ${coinLabel}\n📤 To address: <code>${shortAddr}</code>\n🔗 TX: <code>${hash.slice(0, 16)}...</code>`
          : `✅ <b>Транзакция отправлена</b>\n\n💸 ${amountNum} ${coinLabel}\n📤 На адрес: <code>${shortAddr}</code>\n🔗 TX: <code>${hash.slice(0, 16)}...</code>`;
        if (token) {
          fetch('/api/tg-notify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'x-trace-id': traceId,
            },
            body: JSON.stringify({ message: msg }),
          }).catch(() => {/* silent — уведомление не критично */});
        }
      }
    } catch (e: unknown) {
      track('send_failed', { coin }, traceId);
      finalizeDraft('failed');
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      if (msg.includes('no_keystore')) {
        setSendErr(t('csErrNoWallet'));
      } else if (msg.includes('no_sol_enc')) {
        setSendErr(t('csErrNoSol'));
      } else if (msg.includes('password') || msg.includes('invalid') || msg.includes('decrypt') || msg.includes('bad mac') || msg.includes('неверный пароль')) {
        setPwError(t('csErrWrongPassword'));
      } else if (msg.includes('insufficient') || msg.includes('insufficient funds')) {
        setSendErr(t('csErrInsufficientFee'));
      } else if (msg.includes('nonce') || msg.includes('replacement')) {
        setSendErr(t('csErrPendingTx'));
      } else if (msg.includes('no_btc_enc')) {
        setSendErr(t('csErrNoBtc'));
      } else if (msg.includes('no_tron_enc')) {
        setSendErr(t('csErrNoTron'));
      } else if (msg.includes('no_ton_enc')) {
        setSendErr(t('csErrNoTon'));
      } else if (msg.includes('trongrid') || msg.includes('tron') && msg.includes('недоступен')) {
        setSendErr(t('csErrTrongridDown'));
      } else if (msg.includes('utxo') || msg.includes('подтверждённых')) {
        setSendErr(t('csErrNoUtxo'));
      } else if (msg.includes('dust') || msg.includes('546')) {
        setSendErr(t('csErrDust'));
      } else if (msg.includes('segwit') || msg.includes('bc1')) {
        setSendErr(e instanceof Error ? e.message : t('csErrSegwit'));
      } else if (msg.includes('blockhash not found') || msg.includes('blockhash')) {
        setSendErr(t('csErrSolanaNetwork'));
      } else {
        setSendErr(`${t('csErrGeneric')} ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
      }
      onAvatarState?.('idle');
    } finally {
      setSending(false);
    }
  };

  // ─── Done screen ──────────────────────────────────────────────────────────
  if (step === 'done') {
    const shortHash = txHash ? `${txHash.slice(0, 10)}…${txHash.slice(-6)}` : null;
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center gap-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: data.bgColor, border: `2px solid ${data.color}` }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={data.color}
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <div>
          <p className="text-white text-xl font-bold">{t('csSent').replace('{amt}', String(amountNum)).replace('{coin}', coin)}</p>
          <p className="text-[#3A6045] text-sm mt-1">
            {`${recipientName ? `${recipientName} • ` : ''}${t('csTxSentToNetwork')}`}
          </p>
        </div>

        {txHash && (
          <div
            className="w-full rounded-2xl p-4 text-left"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
          >
            <p className="text-[#3A6045] text-xs mb-1">TX Hash</p>
            <p className="text-white text-xs font-mono break-all">{shortHash}</p>
            <a
              href={
                coin === 'SOL'
                  ? `https://solscan.io/tx/${txHash}`
                  : coin === 'BTC'
                  ? `https://blockstream.info/tx/${txHash}`
                  : coin === 'TRX' || coin === 'TRC20'
                  ? `https://tronscan.org/#/transaction/${txHash}`
                  : coin === 'TON' || coin === 'USDT_TON'
                  ? `https://tonscan.org/tx/${txHash}`
                  : `https://etherscan.io/tx/${txHash}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-semibold"
              style={{ color: '#00FF7F' }}
            >
              {coin === 'SOL'                        ? t('csViewOnSolscan')
               : coin === 'BTC'                      ? t('csViewOnBlockstream')
               : coin === 'TRX' || coin === 'TRC20'    ? t('csViewOnTronscan')
               : coin === 'TON' || coin === 'USDT_TON' ? t('csViewOnTonscan')
               : t('csViewOnEtherscan')}
            </a>
          </div>
        )}

        <div
          className="w-full rounded-2xl p-3.5"
          style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.12)' }}
        >
          <p className="text-[#00FF7F] text-xs font-semibold mb-1">{t('navNeura')}</p>
          <p className="text-white text-xs leading-relaxed">
            {txHash
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
      <div className="px-6 pt-2 flex flex-col gap-5">
        <h2 className="text-white text-lg font-bold">{t('csEnterWalletPassword')}</h2>

        <div
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.10)' }}
        >
          <div className="flex justify-between text-xs">
            <span className="text-[#3A6045]">{t('csYouSend')}</span>
            <span className="text-white font-bold">{amountNum} {coin}</span>
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
              onKeyDown={(e) => e.key === 'Enter' && password && handleConfirmSend()}
              placeholder={t('csPasswordPlaceholder')}
              autoFocus
              className="w-full bg-transparent text-white text-sm outline-none placeholder:text-[#3A6045]"
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
    const confirmDisabled = realReview && (simLoading || simBlocked);

    const fmtAmount = (v: number) =>
      v >= 1 ? v.toFixed(4).replace(/\.?0+$/, '') : v.toPrecision(3);

    const feeNode = !realReview
      ? <span key="f" className="text-[#3A6045]">{FEE_EUR[coin]}</span>
      : simLoading
        ? <span key="f" className="text-[#3A6045] animate-pulse">{t('csSimulating')}</span>
        : sim?.feeNative != null
          ? <span key="f" className="text-white">
              ≈ {fmtAmount(sim.feeNative)} {sim.feeCurrency}
              {sim.feeEur != null ? ` (€${sim.feeEur.toFixed(2)})` : ''}
            </span>
          : <span key="f" style={{ color: '#F7931A' }}>{t('csFeeUnknown')}</span>;

    return (
      <div className="px-6 pt-2 flex flex-col gap-4">
        <h2 className="text-white text-lg font-bold">{t('csConfirmTitle')}</h2>

        <div
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
        >
          {([
            [t('csCoin'),   <span key="c" className="flex items-center gap-1.5"><span className="font-bold" style={{ color: data.color }}>{data.icon}</span><span className="text-white">{coin}</span></span>],
            [t('csAmount'),    <span key="a" className="text-white font-bold">{amountNum} {coin}</span>],
            [t('csFee'), feeNode],
            ...(realReview && sim?.balanceAfter != null
              ? [[t('csBalanceAfter'), <span key="ba" className="text-white">{fmtAmount(sim.balanceAfter)} {coin}</span>]] as [string, React.ReactNode][]
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
              {t(WARNING_I18N[w.code])}
            </p>
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
              {t('csComingSoonWarning').replace('{coin}', coin)}
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
            onClick={() => data.implemented && !isDemo ? setStep('password') : handleConfirmSend()}
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
  return (
    <div className="px-6 pt-2 flex flex-col gap-5">
      <h2 className="text-white text-lg font-bold">{t('csTitle')}</h2>

      {/* Coin selector */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-2">{t('csCoinLabel')}</p>
        <div className="flex gap-2">
          {(['ETH', 'BTC', 'SOL', 'USDT', 'TRX', 'TRC20', 'TON', 'USDT_TON'] as Coin[]).map((c) => {
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
                  {c === 'USDT' ? 'USDT\nERC' : c === 'TRC20' ? 'USDT\nTRC' : c === 'USDT_TON' ? 'USDT\nTON' : c}
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
            ? <span className="text-white font-medium">{available.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {coin}</span>
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
            onChange={(e) => setAddress(e.target.value)}
            placeholder={data.placeholder}
            className="w-full bg-transparent text-white text-sm outline-none placeholder:text-[#3A6045] font-mono"
            style={{ caretColor: '#00FF7F' }}
          />
        </div>
        {address && !addressValid && (
          <p className="text-xs mt-1" style={{ color: '#FF5252' }}>{t('csInvalidAddress')}</p>
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
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="text-white text-4xl font-bold bg-transparent outline-none w-32 text-center"
              style={{ caretColor: '#00FF7F' }}
            />
            <span className="text-[#3A6045] text-lg font-bold">{coin}</span>
          </div>
          {amountNum > 0 && (
            <p className="text-sm mt-1.5">
              {insufficient
                ? <span style={{ color: '#FF5252' }}>{t('csInsufficientFunds')}</span>
                : <span className="text-[#3A6045]">{t('csAvailableInline').replace('{amt}', available.toLocaleString('ru-RU', { maximumFractionDigits: 6 })).replace('{coin}', coin)}</span>
              }
            </p>
          )}
          {/* MAX button */}
          {available > 0 && !insufficient && (
            <button
              onClick={() => setAmount(String(available))}
              className="mt-2 text-xs font-semibold px-3 py-1 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(0,255,127,0.08)', color: '#00FF7F' }}
            >
              MAX
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => setStep('confirm')}
        disabled={!addressValid || !amountNum || insufficient}
        className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30"
        style={{ background: '#00FF7F', color: '#080C09' }}
      >
        {t('csContinue')}
      </button>
    </div>
  );
};

export default CryptoSendScreen;
