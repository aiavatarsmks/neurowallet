import React, { useState } from 'react';

const FIAT = 2847.50;
const CRYPTO = [
  { symbol: 'BTC',  valueEUR: 2310, change: +4.2  },
  { symbol: 'ETH',  valueEUR: 2542, change: +1.8  },
  { symbol: 'USDT', valueEUR: 110,  change:  0    },
];
const CRYPTO_TOTAL = CRYPTO.reduce((s, a) => s + a.valueEUR, 0);
const TOTAL = FIAT + CRYPTO_TOTAL;

type View = 'total' | 'fiat' | 'crypto';

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

export const BalanceCard: React.FC = () => {
  const [view, setView] = useState<View>('total');

  const balance = view === 'total' ? TOTAL : view === 'fiat' ? FIAT : CRYPTO_TOTAL;
  const label = view === 'total' ? 'Общий капитал' : view === 'fiat' ? 'Фиат EUR' : 'Крипто-портфель';

  return (
    <div className="px-6 pt-1 pb-4">
      <p className="text-[#3A6045] text-sm font-medium mb-3">{getGreeting()}, Макс</p>

      {/* View switcher */}
      <div className="flex gap-1 mb-3">
        {(['total', 'fiat', 'crypto'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all active:scale-95"
            style={{
              background: view === v ? 'rgba(0,255,127,0.15)' : 'transparent',
              color: view === v ? '#00FF7F' : '#3A6045',
              border: `1px solid ${view === v ? 'rgba(0,255,127,0.3)' : 'transparent'}`,
            }}
          >
            {v === 'total' ? 'Всего' : v === 'fiat' ? 'Фиат' : 'Крипто'}
          </button>
        ))}
      </div>

      <p className="text-[#3A6045] text-xs mb-0.5">{label}</p>
      <p
        className="text-4xl font-bold text-white tracking-tight"
        style={{ textShadow: '0 0 24px rgba(0,255,127,0.25)' }}
      >
        €{fmt(balance)}
      </p>

      {/* Total view — crypto mini row */}
      {view === 'total' && (
        <div className="flex gap-3 mt-3 flex-wrap">
          {CRYPTO.map((a) => (
            <div key={a.symbol} className="flex items-center gap-1.5">
              <span className="text-[#3A6045] text-xs">{a.symbol}</span>
              <span className="text-white text-xs font-medium">€{a.valueEUR.toLocaleString('ru-RU')}</span>
              <span
                className="text-[10px] font-semibold"
                style={{ color: a.change > 0 ? '#00FF7F' : a.change < 0 ? '#FF5252' : '#3A6045' }}
              >
                {a.change > 0 ? '+' : ''}{a.change}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Fiat breakdown */}
      {view === 'fiat' && (
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

      {/* Crypto summary */}
      {view === 'crypto' && (
        <p className="text-[#00FF7F] text-xs font-medium mt-1.5">
          +€521,30 за месяц (+11.7%)
        </p>
      )}
    </div>
  );
};

export default BalanceCard;
