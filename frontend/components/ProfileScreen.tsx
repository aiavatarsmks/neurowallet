import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';

interface Policy {
  id: string;
  label: string;
  description: string;
  active: boolean;
}

const INITIAL_POLICIES: Policy[] = [
  { id: '1', label: 'Лимит: рестораны',    description: '$300/мес',          active: true  },
  { id: '2', label: 'Авто-резерв',          description: '10% от входящих',   active: true  },
  { id: '3', label: 'Алерт >$500',          description: 'Большие транзакции', active: true  },
  { id: '4', label: 'Налоговый резерв',     description: '20% от дохода',      active: false },
  { id: '5', label: 'Автооплата подписок',  description: 'Spotify, Netflix',   active: false },
];

const ShieldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const BellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

export const ProfileScreen: React.FC = () => {
  const router = useRouter();
  const { user, isDemo, signOut } = useAuth();
  const [policies, setPolicies] = useState<Policy[]>(INITIAL_POLICIES);

  const displayName = isDemo ? 'Demo Mode' : (user?.name ?? 'Пользователь');
  const displayEmail = isDemo ? 'demo@neurowallet.ai' : (user?.email ?? '');
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = () => {
    signOut();
    router.replace('/');
  };

  const togglePolicy = (id: string) => {
    setPolicies((p) => p.map((pol) => pol.id === id ? { ...pol, active: !pol.active } : pol));
  };

  const activePolicies = policies.filter((p) => p.active).length;

  return (
    <div className="px-6 pt-2 pb-6 flex flex-col gap-5">
      {/* Profile card */}
      <div
        className="rounded-3xl p-5 flex items-center gap-4"
        style={{ background: 'linear-gradient(135deg, #0D1A10 0%, #0A1A12 100%)', border: '1px solid rgba(0,255,127,0.12)' }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
          style={{ background: 'rgba(0,255,127,0.12)', border: '2px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
        >
          {initials}
        </div>
        <div className="flex-1">
          <p className="text-white font-bold text-base">{displayName}</p>
          <p className="text-[#3A6045] text-xs mt-0.5">{displayEmail}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-[#00FF7F]" />
            <span className="text-[#00FF7F] text-[10px] font-semibold">NeuroWallet Pro</span>
          </div>
        </div>
      </div>

      {/* Trust level */}
      <div className="rounded-2xl p-4" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <div className="flex justify-between items-center mb-3">
          <p className="text-white text-sm font-semibold">Уровень доверия Нейры</p>
          <span className="text-[#00FF7F] text-xs font-bold">Средний</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,127,0.1)' }}>
          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: '60%', background: 'linear-gradient(to right, #00CC60, #00FF7F)', boxShadow: '0 0 8px rgba(0,255,127,0.5)' }} />
        </div>
        <p className="text-[#3A6045] text-xs mt-2">Нейра может: инсайты, черновики, алерты. Для автоисполнения — повысь уровень.</p>
      </div>

      {/* Policies */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-white text-sm font-semibold">Мои правила</p>
          <span className="text-[#3A6045] text-xs">{activePolicies} активных</span>
        </div>
        <div className="flex flex-col gap-2">
          {policies.map((pol) => (
            <div
              key={pol.id}
              className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: '#0D1A10', border: `1px solid ${pol.active ? 'rgba(0,255,127,0.15)' : 'rgba(255,255,255,0.05)'}` }}
            >
              <div className="flex-1">
                <p className="text-white text-sm font-medium">{pol.label}</p>
                <p className="text-[#3A6045] text-xs mt-0.5">{pol.description}</p>
              </div>
              <button
                onClick={() => togglePolicy(pol.id)}
                className="relative w-11 h-6 rounded-full flex-shrink-0 transition-all"
                style={{ background: pol.active ? 'rgba(0,255,127,0.25)' : 'rgba(255,255,255,0.06)' }}
              >
                <div
                  className="absolute top-1 w-4 h-4 rounded-full transition-all"
                  style={{
                    left: pol.active ? '22px' : '4px',
                    background: pol.active ? '#00FF7F' : '#3A6045',
                    boxShadow: pol.active ? '0 0 6px rgba(0,255,127,0.6)' : 'none',
                  }}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Settings */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">Настройки</p>
        <div className="flex flex-col gap-1">
          {[
            { icon: <ShieldIcon />, label: 'Безопасность', sub: '2FA включена' },
            { icon: <BellIcon />,   label: 'Уведомления', sub: 'Push + Email' },
            { icon: <GlobeIcon />,  label: 'Язык и регион', sub: 'Русский · RU' },
          ].map((item, i) => (
            <button
              key={i}
              className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left transition-all active:scale-[0.98]"
              style={{ background: '#0D1A10' }}
            >
              <span style={{ color: '#3A6045' }}>{item.icon}</span>
              <div className="flex-1">
                <p className="text-white text-sm">{item.label}</p>
                <p className="text-[#3A6045] text-xs mt-0.5">{item.sub}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A6045" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleSignOut}
        className="w-full py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-95"
        style={{ background: 'transparent', border: '1px solid rgba(255,59,48,0.3)', color: '#ff3b30' }}
      >
        {isDemo ? 'Выйти из демо-режима' : 'Выйти из аккаунта'}
      </button>
    </div>
  );
};

export default ProfileScreen;
