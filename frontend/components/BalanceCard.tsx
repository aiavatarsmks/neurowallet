import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchRealBalances, WalletBalances } from '@/lib/crypto/balances';

// ── Demo data (shown in demo mode only) ──────────────────────────────────────
const DEMO_FIAT_TOTAL  = 5157.00;
const DEMO_CRYPTO_TOTAL = 2652.50;
const DEMO_TOTAL        = DEMO_FIAT_TOTAL + DEMO_CRYPTO_TOTAL;
const DEMO_CRYPTO_ROWS  = [
  { symbol: 'BTC',  valueEUR: 2310, change: +4.2 },
  { symbol: 'ETH',  valueEUR: 2542, change: +1.8 },  // wait, these don't add to 2652 but keeping original demo values
  { symbol: 'USDT', valueEUR: 110,  change: 0    },
];
const DEMO_FIAT_ROWS = [
  { label: 'Основной счёт', valueEUR: 3847.50 },
  { label: 'Накопительный', valueEUR: 1309.50 },
];

type View = 'total' | 'fiat' | 'crypto';

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
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

    const eth  = localStorage.getItem('wallet_eth_address');
    if (!eth) return; // demo mode

    setIsReal(true);
    setLoading(true);

    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';

    fetchRealBalances(eth, sol, btc, tron, ton)
      .then((b: WalletBalances) => { setBalances(b); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user]);

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
    view === 'total' ? (isDemo ? 'Общий баланс'   : 'Крипто-портфель') :
    view === 'fiat'  ? 'Фиат' :
    'Крипто-портфель';

  const cryptoRows = isDemo
    ? DEMO_CRYPTO_ROWS
    : balances
      ? [
          { symbol: 'BTC',  valueEUR: balances.btc * balances.btcEur, change: 0 },
          { symbol: 'ETH',  valueEUR: balances.eth * balances.ethEur, change: 0 },
          { symbol: 'TRX',  valueEUR: balances.trx * balances.trxEur, change: 0 },
          { symbol: 'USDT', valueEUR: balances.usdt,                  change: 0 },
        ]
      : [];

  const visibleViews: View[] = isDemo ? ['total', 'fiat', 'crypto'] : ['total', 'crypto'];

  return (
    <div className="px-6 pt-1 pb-4">
      <p className="text-[#3A6045] text-sm font-medium mb-3">
        {getGreeting()}{displayName ? `, ${displayName}` : ''}
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
            {v === 'total' ? 'Всего' : v === 'fiat' ? 'Фиат' : 'Крипто'}
          </button>
        ))}
      </div>

      <p className="text-[#3A6045] text-xs mb-0.5">{label}</p>

      {loading ? (
        <div className="flex items-center gap-2 py-1">
          <div className="w-2 h-2 rounded-full bg-[#00FF7F] opacity-60" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
          <span className="text-[#3A6045] text-sm">Загружаем...</span>
          <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
        </div>
      ) : (
        <p
          className="text-4xl font-bold text-white tracking-tight"
          style={{ textShadow: '0 0 24px rgba(0,255,127,0.25)' }}
        >
          €{fmt(balance)}
        </p>
      )}

      {/* Total / Crypto view — asset mini row */}
      {(view === 'total' || view === 'crypto') && !loading && (
        <div className="flex gap-3 mt-3 flex-wrap">
          {cryptoRows.map((a) => (
            <div key={a.symbol} className="flex items-center gap-1.5">
              <span className="text-[#3A6045] text-xs">{a.symbol}</span>
              <span className="text-white text-xs font-medium">€{a.valueEUR.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
              {a.change !== 0 && (
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: a.change > 0 ? '#00FF7F' : '#FF5252' }}
                >
                  {a.change > 0 ? '+' : ''}{a.change}%
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
                <span className="text-white text-xs font-semibold">€{fmt(r.valueEUR)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[#3A6045] text-xs mt-1.5">Фиат-счёт — скоро</p>
        )
      )}

      {/* No wallet yet (real mode only) */}
      {!isDemo && view !== 'fiat' && !isReal && !loading && (
        <p className="text-[#3A6045] text-xs mt-1.5">Создайте кошелёк, чтобы увидеть баланс</p>
      )}
    </div>
  );
};

export default BalanceCard;
