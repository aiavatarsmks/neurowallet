import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayCurrency } from '@/contexts/DisplayCurrencyContext';
import { fetchRealBalances, MARKET_REFRESH_MS, WalletBalances } from '@/lib/crypto/balances';
import { SUPPORTED_ASSETS, tonNativeFirst, type AssetSymbol } from '@/lib/crypto/assets';
import { formatPercent } from '@/lib/display-format';
import {
  DEMO_HOLDINGS, demoValueEUR, DEMO_CRYPTO_TOTAL_EUR, DEMO_FIAT_TOTAL_EUR,
  DEMO_TOTAL_EUR, DEMO_FIAT_ACCOUNTS,
} from '@/lib/demo-data';

// ── Demo data (shown in demo mode only) ──────────────────────────────────────
// All demo figures come from the shared dataset; totals are computed there,
// so home / portfolio / send can't disagree.
const DEMO_FIAT_TOTAL   = DEMO_FIAT_TOTAL_EUR;
const DEMO_CRYPTO_TOTAL = DEMO_CRYPTO_TOTAL_EUR;
const DEMO_TOTAL        = DEMO_TOTAL_EUR;
const DEMO_CRYPTO_ROWS  = DEMO_HOLDINGS
  .map((h) => ({ symbol: h.symbol, valueEUR: demoValueEUR(h), change: h.change24h }))
  .filter((r) => r.valueEUR > 0);
const DEMO_FIAT_ROWS = DEMO_FIAT_ACCOUNTS;

type View = 'total' | 'fiat' | 'crypto';

function getGreeting(t: (k: any) => string): string {
  const h = new Date().getHours();
  return h < 12 ? t('greetingMorning') : h < 18 ? t('greetingDay') : t('greetingEvening');
}

function calcCryptoTotal(b: WalletBalances): number {
  return (
    b.btc * b.btcEur +
    b.eth * b.ethEur +
    b.sol * b.solEur +
    b.usdt + b.usdtTrc + b.usdtTon +
    b.trx * b.trxEur +
    b.ton * b.tonEur
  );
}

export const BalanceCard: React.FC = () => {
  const { user, isDemo } = useAuth();
  const { t } = useLanguage();
  const { formatFiat } = useDisplayCurrency();
  const [view,         setView]         = useState<View>('total');
  const [isReal,       setIsReal]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [balances,     setBalances]     = useState<WalletBalances | null>(null);
  const [displayName,  setDisplayName]  = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Resolve display name: user meta → TG first name → nothing
    const tgName = localStorage.getItem('tg_first_name');
    setDisplayName(user?.name?.split(' ')[0] || tgName || '');

    if (isDemo) {
      setIsReal(false);
      setBalances(null);
      setLoading(false);
      return;
    }

    const eth  = localStorage.getItem('wallet_eth_address');
    if (!eth) return; // demo mode

    setIsReal(true);
    setLoading(true);

    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';

    const loadBalances = () => {
      fetchRealBalances(eth, sol, btc, tron, ton)
        .then((b: WalletBalances) => { setBalances(b); setLoading(false); })
        .catch(() => setLoading(false));
    };

    loadBalances();
    const timer = window.setInterval(loadBalances, MARKET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [user, isDemo]);

  // ── Derived values ────────────────────────────────────────────────────────────
  const cryptoTotal = balances ? calcCryptoTotal(balances) : 0;

  // In demo mode we override all values with fake data
  const activeTotal  = isDemo ? DEMO_TOTAL        : cryptoTotal;
  const activeFiat   = isDemo ? DEMO_FIAT_TOTAL   : 0;
  const activeCrypto = isDemo ? DEMO_CRYPTO_TOTAL : cryptoTotal;

  const balance =
    view === 'total' ? activeTotal  :
    view === 'fiat'  ? activeFiat   :
    activeCrypto;

  const label =
    view === 'total' ? (isDemo ? t('labelTotalBalance') : t('labelCryptoPortfolio')) :
    view === 'fiat'  ? t('labelFiat') :
    t('labelCryptoPortfolio');

  const cryptoRows = isDemo
    ? DEMO_CRYPTO_ROWS
    : balances
      ? SUPPORTED_ASSETS.map((asset) => {
          const amounts: Record<AssetSymbol, number> = {
            BTC: balances.btc,
            ETH: balances.eth,
            SOL: balances.sol,
            USDT: balances.usdt,
            TRX: balances.trx,
            USDT_TRC: balances.usdtTrc,
            TON: balances.ton,
            USDT_TON: balances.usdtTon,
          };
          const prices: Record<AssetSymbol, number> = {
            BTC: balances.btcEur,
            ETH: balances.ethEur,
            SOL: balances.solEur,
            USDT: 1,
            TRX: balances.trxEur,
            USDT_TRC: 1,
            TON: balances.tonEur,
            USDT_TON: 1,
          };
          const changes: Record<AssetSymbol, number> = {
            BTC: balances.btcChange24h,
            ETH: balances.ethChange24h,
            SOL: balances.solChange24h,
            USDT: 0,
            TRX: balances.trxChange24h,
            USDT_TRC: 0,
            TON: balances.tonChange24h,
            USDT_TON: 0,
          };
          return {
            symbol: asset.symbol,
            valueEUR: amounts[asset.symbol] * prices[asset.symbol],
            change: changes[asset.symbol],
          };
        })
      : [];

  // 2.10 TON-native positioning: TON assets rank first in the home asset row
  // (does not affect the send picker). Non-TON assets keep their relative order.
  const orderedCryptoRows = tonNativeFirst(cryptoRows);

  const visibleViews: View[] = isDemo ? ['total', 'fiat', 'crypto'] : ['total', 'crypto'];

  return (
    <div className="px-6 pt-1 pb-4">
      <p className="text-[#3A6045] text-sm font-medium mb-3">
        {getGreeting(t)}{displayName ? `, ${displayName}` : ''}
      </p>

      {/* View switcher */}
      <div className="flex gap-1 mb-3">
        {visibleViews.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all active:scale-95"
            style={{
              background: view === v ? 'rgba(0,255,127,0.15)' : 'transparent',
              color:      view === v ? '#00FF7F'               : '#3A6045',
              border:     `1px solid ${view === v ? 'rgba(0,255,127,0.3)' : 'transparent'}`,
            }}
          >
            {v === 'total' ? t('viewTotal') : v === 'fiat' ? t('viewFiat') : t('viewCrypto')}
          </button>
        ))}
      </div>

      <p className="text-[#3A6045] text-xs mb-0.5">{label}</p>

      {loading ? (
        <div className="flex items-center gap-2 py-1">
          <div className="w-2 h-2 rounded-full bg-[#00FF7F] opacity-60" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
          <span className="text-[#3A6045] text-sm">{t('loadingText')}</span>
          <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
        </div>
      ) : (
        <p
          className="text-4xl font-bold text-white tracking-tight"
          style={{ textShadow: '0 0 24px rgba(0,255,127,0.25)' }}
        >
          {formatFiat(balance)}
        </p>
      )}

      {/* Total / Crypto view — asset mini row */}
      {(view === 'total' || view === 'crypto') && !loading && (
        <div className="flex gap-3 mt-3 flex-wrap">
          {orderedCryptoRows.map((a) => (
            <div key={a.symbol} className="flex items-center gap-1.5">
              <span className="text-[#3A6045] text-xs">{a.symbol}</span>
              <span className="text-white text-xs font-medium">{formatFiat(a.valueEUR, { maximumFractionDigits: 2 })}</span>
              {a.change !== 0 && (
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: a.change > 0 ? '#00FF7F' : '#FF5252' }}
                >
                  {formatPercent(a.change)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fiat view */}
      {view === 'fiat' && (
        isDemo ? (
          <div className="flex gap-4 mt-3">
            {DEMO_FIAT_ROWS.map((r) => (
              <div key={r.label} className="flex flex-col gap-0.5">
                <span className="text-[#3A6045] text-[10px]">{r.label}</span>
                <span className="text-white text-xs font-semibold">{formatFiat(r.valueEUR)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[#3A6045] text-xs mt-1.5">{t('fiatComingSoon')}</p>
        )
      )}

      {/* No wallet yet (real mode only) */}
      {!isDemo && view !== 'fiat' && !isReal && !loading && (
        <p className="text-[#3A6045] text-xs mt-1.5">{t('noWalletYet')}</p>
      )}
    </div>
  );
};

export default BalanceCard;
