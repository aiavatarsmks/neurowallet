import React from 'react';

type Tab = 'home' | 'send' | 'add' | 'cards' | 'wallet';

interface BottomNavProps {
  active?: Tab;
  onTabChange?: (tab: Tab) => void;
}

const HomeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const SendIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const CardsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
    <line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
);

const WalletIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
    <path d="M16 3H8a1 1 0 0 0-1 1v3h10V4a1 1 0 0 0-1-1z"/>
    <circle cx="17" cy="14" r="1" fill="currentColor"/>
  </svg>
);

const NAV_ITEMS = [
  { id: 'home'  as Tab, label: 'Главная',   Icon: HomeIcon  },
  { id: 'send'  as Tab, label: 'Отправить', Icon: SendIcon  },
  { id: 'cards' as Tab, label: 'Карты',     Icon: CardsIcon },
  { id: 'wallet'as Tab, label: 'Активы',    Icon: WalletIcon },
];

export const BottomNav: React.FC<BottomNavProps> = ({ active = 'home', onTabChange }) => {
  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] flex items-center justify-around px-4 pt-3 pb-8"
      style={{
        background: 'linear-gradient(to top, #080C09 80%, rgba(8,12,9,0.7))',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(0,255,127,0.08)',
        zIndex: 50,
      }}
    >
      {/* Left two */}
      {NAV_ITEMS.slice(0, 2).map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange?.(id)}
            className="flex flex-col items-center gap-1 transition-all active:scale-90"
            style={{ color: isActive ? '#00FF7F' : '#3A6045' }}
          >
            <Icon />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}

      {/* Center FAB — Нейра */}
      <div className="flex flex-col items-center -mt-4 gap-0.5">
        <button
          onClick={() => onTabChange?.('add')}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{
            background: active === 'add'
              ? 'linear-gradient(135deg, #00FF7F, #00CC60)'
              : '#00FF7F',
            boxShadow: `0 0 ${active === 'add' ? '32px' : '20px'} rgba(0,255,127,${active === 'add' ? '0.6' : '0.45'}), 0 4px 16px rgba(0,0,0,0.4)`,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
            <polyline points="6,22 6,6 22,22 22,6" stroke="#080C09" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-[10px] font-medium" style={{ color: active === 'add' ? '#00FF7F' : '#3A6045' }}>Нейра</span>
      </div>

      {/* Right two */}
      {NAV_ITEMS.slice(2).map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange?.(id)}
            className="flex flex-col items-center gap-1 transition-all active:scale-90"
            style={{ color: isActive ? '#00FF7F' : '#3A6045' }}
          >
            <Icon />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
