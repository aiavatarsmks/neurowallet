import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchRealBalances, WalletBalances } from '@/lib/crypto/balances';

// ─── Demo constants (shown only when no real wallet) ──────────────────────────
const DEMO_FIAT = 2847.50;
const DEMO_CRYPTO = [
  { symbol: 'BTC',  valueEUR: 2310, change: +4.2 },
  { symbol: 'ETH',  valueEUR: 2542, change: +1.8 },
  { symbol: 'USDT', valueEUR: 110,  change:  0   },
];
const DEMO_CRYPTO_TOTAL = DEMO_CRYPTO.reduce((s, a) => s + a.valueEUR, 0);
const DEMO_TOTAL        = DEMO_FIAT + DEMO_CRYPTO_TOTAL;

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
    b.ton * b.tonEur
  );
}

export const BalanceCard: React.FC = () => {
  const { user } = useAuth();
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
  const cryptoTotal = balances ? calcCryptoTotal(balances) : (isReal ? 0 : DEMO_CRYPTO_TOTAL);
  const totalBalance = isReal ? cryptoTotal : DEMO_TOTAL;

  const balance =
    view === 'total' ? totalBalance :
    view === 'fiat'  ? (isReal ? 0 : DEMO_FIAT) :
    cryptoTotal;

  const label =
    view === 'total' ? (isReal ? 'Крипто-портфель'  : 'Общий капитал') :
    view === 'fiat'  ? (isReal ? 'Фиат'             : 'Фиат EUR')       :
    'Крипто-портфель';

  const cryptoRows = balances
    ? [
        { symbol: 'BTC',  valueEUR: balances.btc * balances.btcEur, change: 0 },
        { symbol: 'ETH',  valueEUR: balances.eth * balances.ethEur, change: 0 },
        { symbol: 'USDT', valueEUR: balances.usdt,                  change: 0 },
      ]
    : DEMO_CRYPTO;

  return (
    <div className="px-6 pt-1 pb-4">
      <p className="text-[#3A6045] text-sm font-medium mb-3">
        {getGreeting()}{displayName ? `, ${displayName}` : ''}
      </p>

      {/* View switcher — hide Fiat tab in real mode */}
      <div className="flex gap-1 mb-3">
        {(['total', ...(isReal ? [] : ['fiat']), 'crypto'] as View[]).map((v) => (
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

      {/* Total view — crypto mini row */}
      {view === 'total' && !loading && (
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

      {/* Fiat breakdown — demo only */}
      {view === 'fiat' && !isReal && (
        <div className="flex gap-6 mt-3">
          <div>
            <p className="text-[#3A6045] text-[10px]">Текущий счёт</p>
            <p className="text-white text-sm font-medium">€2 100,00</p>
          </div>
          <div>
            <p className="text-[#3A6045] text-[10px]">Накопления</p>
            <p className="text-white text-sm font-medium">€747,50</p>
          </div>
        </div>
      )}

      {/* Fiat in real mode — coming soon */}
      {view === 'fiat' && isReal && (
        <p className="text-[#3A6045] text-xs mt-1.5">Фиат-счёт — скоро</p>
      )}

      {/* Crypto summary */}
      {view === 'crypto' && !isReal && (
        <p className="text-[#00FF7F] text-xs font-medium mt-1.5">
          +€521,30 за месяц (+11.7%)
        </p>
      )}
    </div>
  );
};

export default BalanceCard;
