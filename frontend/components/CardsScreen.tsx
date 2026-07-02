import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

const DEMO_CARD = {
  holder: 'МАКС ИВАНОВ',
  last4: '4921',
  expiry: '09/28',
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
  const { t } = useLanguage();

  if (!isDemo) {
    return (
      <div className="px-6 pt-2 pb-6 flex flex-col gap-5">
        <h2 className="text-white text-lg font-bold">{t('cardsTitle')}</h2>
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
            <p className="text-white text-base font-semibold mb-1">{t('cardsComingSoonTitle')}</p>
            <p className="text-[#3A6045] text-sm leading-relaxed">
              {t('cardsComingSoonText')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const usedPct = Math.round((DEMO_CARD.spent / DEMO_CARD.limit) * 100);

  return (
    <div className="px-6 pt-2 pb-8 flex flex-col gap-5">
      <h2 className="text-white text-lg font-bold">{t('cardsTitle')}</h2>

      {/* Card visual */}
      <div
        className="relative overflow-hidden"
        style={{
          minHeight: 225,
          borderRadius: 26,
          padding: '28px 28px 24px',
          background:
            'linear-gradient(135deg, #062816 0%, #06391d 44%, #021006 100%)',
          border: '1px solid rgba(0,255,127,0.28)',
          boxShadow:
            '0 18px 42px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,255,127,0.12)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 18% 18%, rgba(0,255,127,0.14) 0, transparent 32%), radial-gradient(circle at 72% 18%, rgba(0,255,127,0.2) 0, transparent 30%), radial-gradient(circle at 52% 82%, rgba(0,180,90,0.15) 0, transparent 38%)',
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            inset: 0,
            background:
              'linear-gradient(115deg, transparent 0%, rgba(255,255,255,0.06) 38%, transparent 58%)',
            transform: 'translateX(-18%)',
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            left: 22,
            right: 22,
            top: 92,
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(0,255,127,0.26), transparent)',
          }}
        />

        <div className="relative z-10 flex justify-between items-start">
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-[0.22em] mb-1.5"
              style={{ color: 'rgba(0,255,127,0.28)' }}
            >
              NEUROWALLET
            </p>
            <p className="text-white text-base font-semibold leading-none">{t('cardsVirtualLabel')}</p>
          </div>
          <div
            className="flex-shrink-0"
            style={{
              width: 48,
              height: 34,
              borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(0,255,127,0.22), rgba(0,255,127,0.05))',
              border: '1px solid rgba(0,255,127,0.38)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)',
            }}
          />
        </div>

        <p
          className="relative z-10 font-mono"
          style={{
            marginTop: 52,
            marginBottom: 26,
            color: 'rgba(255,255,255,0.92)',
            fontSize: 21,
            letterSpacing: '0.16em',
            textShadow: '0 0 14px rgba(0,255,127,0.16)',
            whiteSpace: 'nowrap',
          }}
        >
          **** **** **** {DEMO_CARD.last4}
        </p>

        <div className="relative z-10 grid grid-cols-[1.25fr_0.65fr_0.75fr] gap-5 items-end">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] mb-1" style={{ color: 'rgba(0,255,127,0.22)' }}>{t('cardsHolder')}</p>
            <p className="text-white text-sm font-semibold tracking-wide">{DEMO_CARD.holder}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] mb-1" style={{ color: 'rgba(0,255,127,0.22)' }}>{t('cardsExpiry')}</p>
            <p className="text-white text-sm font-semibold">{DEMO_CARD.expiry}</p>
          </div>
          <p
            className="text-right font-serif italic font-bold leading-none"
            style={{
              color: 'rgba(255,255,255,0.92)',
              fontSize: 34,
              letterSpacing: 0,
              textShadow: '0 0 18px rgba(255,255,255,0.12)',
            }}
          >
            VISA
          </p>
        </div>
      </div>

      {/* Limit bar */}
      <div className="rounded-2xl p-4" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <div className="flex justify-between mb-2">
          <span className="text-[#3A6045] text-xs">{t('cardsLimit')}</span>
          <span className="text-white text-xs font-semibold">€{fmt(DEMO_CARD.spent)} / €{fmt(DEMO_CARD.limit)}</span>
        </div>
        <div className="h-1.5 rounded-full" style={{ background: 'rgba(0,255,127,0.1)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${usedPct}%`, background: 'linear-gradient(90deg, #00FF7F, #00CC66)' }}
          />
        </div>
        <p className="text-[#3A6045] text-[10px] mt-1.5">{t('cardsUsedPct').replace('{pct}', String(usedPct))}</p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { icon: '❄️',  label: t('cardsFreeze') },
          { icon: '📋',  label: t('cardsDetails')  },
          { icon: '🍎',  label: 'Apple Pay'  },
          { icon: '⚙️',  label: t('cardsLimits')     },
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
        <p className="text-[#3A6045] text-xs font-medium uppercase tracking-wider mb-3">{t('cardsTransactionsTitle')}</p>
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
