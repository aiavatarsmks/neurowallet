import React from 'react';
import { useAuth } from '@/contexts/AuthContext';

const DEMO_CARD = {
  holder: 'МАКС ИВАНОВ',
  last4: '4921',
  expiry: '12/27',
  limit: 5000,
  spent: 1247,
  transactions: [
    { label: 'Netflix',      amount: -15.99,  date: '26 июн' },
    { label: 'Deliveroo',    amount: -34.50,  date: '25 июн' },
    { label: 'H&M Online',   amount: -89.00,  date: '23 июн' },
    { label: 'Shell',        amount: -48.20,  date: '21 июн' },
    { label: 'Supermarket',  amount: -67.30,  date: '20 июн' },
  ],
};

function fmt(n: number): string {
  return Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const CardsScreen: React.FC = () => {
  const { isDemo } = useAuth();

  if (!isDemo) {
    return (
      <div className="px-6 pt-2 pb-6 flex flex-col gap-5">
        <h2 className="text-white text-lg font-bold">Мои карты</h2>
        <div
          className="flex flex-col items-center justify-center rounded-3xl py-16 gap-4"
          style={{
            background: 'linear-gradient(135deg, rgba(0,255,127,0.06) 0%, rgba(0,255,127,0.02) 100%)',
            border: '1px solid rgba(0,255,127,0.14)',
          }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(0,255,127,0.08)', border: '1px solid rgba(0,255,127,0.2)' }}
          >
            <span className="text-3xl">💳</span>
          </div>
          <div className="text-center px-6">
            <p className="text-white text-base font-semibold mb-1">Виртуальная карта — скоро</p>
            <p className="text-[#3A6045] text-sm leading-relaxed">
              Мы работаем над выпуском виртуальных карт. Они появятся здесь после запуска.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const usedPct = Math.round((DEMO_CARD.spent / DEMO_CARD.limit) * 100);

  return (
    <div className="px-6 pt-2 pb-8 flex flex-col gap-5">
      <h2 className="text-white text-lg font-bold">Мои карты</h2>

      {/* Card visual */}
      <div
        className="rounded-3xl p-6 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0D2B1A 0%, #0A1F14 50%, #071509 100%)',
          border: '1px solid rgba(0,255,127,0.25)',
          boxShadow: '0 8px 32px rgba(0,255,127,0.12)',
        }}
      >
        {/* Decorative glow */}
        <div
          className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #00FF7F 0%, transparent 70%)', transform: 'translate(30%, -30%)' }}
        />
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-[#3A6045] text-xs mb-0.5">NeuroWallet</p>
            <p className="text-white text-sm font-semibold">Виртуальная</p>
          </div>
          <svg width="44" height="28" viewBox="0 0 44 28" fill="none">
            <circle cx="16" cy="14" r="14" fill="#FF5F00" opacity="0.85"/>
            <circle cx="28" cy="14" r="14" fill="#EB001B" opacity="0.7"/>
            <text x="22" y="19" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">VISA</text>
          </svg>
        </div>

        <p className="text-white text-xl font-mono tracking-widest mb-6">
          •••• •••• •••• {DEMO_CARD.last4}
        </p>

        <div className="flex justify-between items-end">
          <div>
            <p className="text-[#3A6045] text-[10px] uppercase tracking-wider mb-0.5">Владелец</p>
            <p className="text-white text-sm font-semibold">{DEMO_CARD.holder}</p>
          </div>
          <div className="text-right">
            <p className="text-[#3A6045] text-[10px] uppercase tracking-wider mb-0.5">Срок</p>
            <p className="text-white text-sm font-semibold">{DEMO_CARD.expiry}</p>
          </div>
        </div>
      </div>

      {/* Limit bar */}
      <div className="rounded-2xl p-4" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <div className="flex justify-between mb-2">
          <span className="text-[#3A6045] text-xs">Лимит</span>
          <span className="text-white text-xs font-semibold">€{fmt(DEMO_CARD.spent)} / €{fmt(DEMO_CARD.limit)}</span>
        </div>
        <div className="h-1.5 rounded-full" style={{ background: 'rgba(0,255,127,0.1)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${usedPct}%`, background: 'linear-gradient(90deg, #00FF7F, #00CC66)' }}
          />
        </div>
        <p className="text-[#3A6045] text-[10px] mt-1.5">Использовано {usedPct}% лимита</p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { icon: '❄️',  label: 'Заморозить' },
          { icon: '📋',  label: 'Реквизиты'  },
          { icon: '🍎',  label: 'Apple Pay'  },
          { icon: '⚙️',  label: 'Лимиты'     },
        ].map((btn) => (
          <button
            key={btn.label}
            className="flex flex-col items-center gap-1.5 rounded-2xl py-3 transition-all active:scale-95"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
          >
            <span className="text-lg">{btn.icon}</span>
            <span className="text-[#3A6045] text-[10px] text-center leading-tight">{btn.label}</span>
          </button>
        ))}
      </div>

      {/* Recent card transactions */}
      <div>
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-3">Транзакции по карте</p>
        <div className="flex flex-col gap-2">
          {DEMO_CARD.transactions.map((tx) => (
            <div
              key={tx.label}
              className="flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
            >
              <div>
                <p className="text-white text-sm font-medium">{tx.label}</p>
                <p className="text-[#3A6045] text-xs">{tx.date}</p>
              </div>
              <span className="text-sm font-semibold" style={{ color: '#FF5252' }}>
                −€{fmt(tx.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CardsScreen;
