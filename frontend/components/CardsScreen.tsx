import React, { useState, useEffect } from 'react';

const CARD_TXS = [
  { id: '1', name: 'Netflix',      date: 'Сегодня',  amount: 15.99 },
  { id: '2', name: 'Deliveroo',    date: 'Вчера',    amount: 34.50 },
  { id: '3', name: 'H&M Online',   date: '17 июн',   amount: 89.00 },
  { id: '4', name: 'Shell',        date: '16 июн',   amount: 48.20 },
  { id: '5', name: 'Supermarket',  date: '15 июн',   amount: 67.30 },
];

const SPENT = 1247.00;
const LIMIT = 5000;

export const CardsScreen: React.FC = () => {
  const [frozen, setFrozen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isReal, setIsReal] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('wallet_eth_address')) {
      setIsReal(true);
    }
  }, []);

  // Real wallet mode: hide demo data, show coming-soon state
  if (isReal) {
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

  const available = LIMIT - SPENT;
  const usedPct = (SPENT / LIMIT) * 100;

  return (
    <div className="px-6 pt-2 pb-6 flex flex-col gap-5">
      <h2 className="text-white text-lg font-bold">Мои карты</h2>

      {/* Virtual card */}
      <div
        className="rounded-3xl p-6 relative overflow-hidden select-none"
        style={{
          background: 'linear-gradient(135deg, #0A1A0E 0%, #0D2B15 45%, #071A0A 100%)',
          border: '1px solid rgba(0,255,127,0.22)',
          minHeight: '184px',
        }}
      >
        <div style={{ position: 'absolute', top: -40, right: -40, width: 150, height: 150, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,255,127,0.13) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -30, left: 10, width: 110, height: 110, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,255,127,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-[#3A6045] text-[10px] uppercase tracking-widest">NeuroWallet</p>
            <p className="text-white text-sm font-semibold mt-0.5">Виртуальная карта</p>
          </div>
          <div className="w-10 h-7 rounded-md" style={{ background: 'linear-gradient(135deg, rgba(0,255,127,0.35), rgba(0,200,80,0.18))', border: '1px solid rgba(0,255,127,0.28)' }} />
        </div>

        <p className="text-white text-[17px] font-mono tracking-[0.18em] mb-4">
          {frozen || !showDetails ? '**** **** **** 4921' : '4716 2843 5501 4921'}
        </p>

        <div className="flex justify-between items-end">
          <div>
            <p className="text-[#3A6045] text-[9px] uppercase tracking-wider mb-0.5">Держатель</p>
            <p className="text-white text-sm font-medium">МАКС ИВАНОВ</p>
          </div>
          <div>
            <p className="text-[#3A6045] text-[9px] uppercase tracking-wider mb-0.5">Срок</p>
            <p className="text-white text-sm font-medium">09/28</p>
          </div>
          <p className="text-white text-2xl font-bold italic" style={{ fontFamily: 'Georgia, serif', letterSpacing: '-0.02em', textShadow: '0 0 12px rgba(255,255,255,0.25)' }}>VISA</p>
        </div>

        {frozen && (
          <div className="absolute inset-0 rounded-3xl flex items-center justify-center" style={{ background: 'rgba(8,12,9,0.72)', backdropFilter: 'blur(3px)' }}>
            <div className="text-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"/>
              </svg>
              <p className="text-[#00FF7F] text-xs font-semibold mt-2">Карта заморожена</p>
            </div>
          </div>
        )}
      </div>

      {/* Limit bar */}
      <div className="rounded-2xl p-4" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <div className="flex justify-between mb-2">
          <p className="text-white text-sm font-semibold">Лимит карты</p>
          <p className="text-[#00FF7F] text-sm font-bold">€{available.toLocaleString('ru-RU')} доступно</p>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,127,0.1)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${usedPct}%`, background: 'linear-gradient(to right, #00CC60, #00FF7F)', boxShadow: '0 0 8px rgba(0,255,127,0.4)' }} />
        </div>
        <div className="flex justify-between mt-1.5">
          <p className="text-[#3A6045] text-xs">Потрачено: €{SPENT.toLocaleString('ru-RU')}</p>
          <p className="text-[#3A6045] text-xs">Лимит: €{LIMIT.toLocaleString('ru-RU')}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: frozen ? 'Разморозить' : 'Заморозить', emoji: '❄️', action: () => setFrozen((f) => !f) },
          { label: 'Реквизиты', emoji: '🔢', action: () => setShowDetails((v) => !v) },
          { label: 'Apple Pay', emoji: '◾', action: () => {} },
          { label: 'Лимиты', emoji: '⚙️', action: () => {} },
        ].map((a, i) => (
          <button
            key={i}
            onClick={a.action}
            className="flex flex-col items-center gap-1.5 rounded-2xl py-3 transition-all active:scale-95"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
          >
            <span className="text-lg">{a.emoji}</span>
            <span className="text-[#3A6045] text-[9px] text-center leading-tight">{a.label}</span>
          </button>
        ))}
      </div>

      {showDetails && (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(0,255,127,0.05)', border: '1px solid rgba(0,255,127,0.15)' }}>
          <p className="text-[#00FF7F] text-xs font-semibold mb-2 uppercase tracking-wider">Реквизиты</p>
          <div className="flex flex-col gap-1.5">
            {[
              ['Номер карты', '4716 2843 5501 4921'],
              ['CVV', '***'],
              ['Срок', '09/28'],
              ['Платёжная система', 'Visa International'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-[#3A6045] text-xs">{label}</span>
                <span className="text-white text-xs font-medium font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">Операции по карте</p>
        {CARD_TXS.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid #0D1A10' }}>
            <div>
              <p className="text-white text-sm font-medium">{tx.name}</p>
              <p className="text-[#3A6045] text-xs mt-0.5">{tx.date}</p>
            </div>
            <span className="text-white text-sm font-semibold">–€{tx.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CardsScreen;
