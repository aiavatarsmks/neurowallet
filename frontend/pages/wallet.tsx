import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { BalanceCard } from '@/components/BalanceCard';
import { TxHistory } from '@/components/TxHistory';
import { TransferButton } from '@/components/TransferButton';
import { BottomNav } from '@/components/BottomNav';
import { MiniChart } from '@/components/MiniChart';
import { SendScreen } from '@/components/SendScreen';
import { NeuraChat } from '@/components/NeuraChat';
import { ProfileScreen } from '@/components/ProfileScreen';
import { CardsScreen } from '@/components/CardsScreen';
import { WalletScreen } from '@/components/WalletScreen';
import { ReceiveScreen } from '@/components/ReceiveScreen';
import { CryptoSendScreen } from '@/components/CryptoSendScreen';

const NeuraAvatar = dynamic(
  () => import('@/components/NeuraAvatar').then((m) => m.NeuraAvatar),
  { ssr: false, loading: () => <div style={{ height: 280 }} /> }
);

type NavTab = 'home' | 'send' | 'add' | 'cards' | 'wallet';
type Tab = NavTab | 'profile' | 'receive' | 'crypto-send';

const HEADER_TITLES: Record<Tab, string> = {
  home:          'NeuroWallet',
  send:          'Отправить',
  add:           'Нейра AI',
  cards:         'Карты',
  wallet:        'Активы',
  profile:       'Профиль',
  receive:       'Получить крипту',
  'crypto-send': 'Отправить крипту',
};

const BACK_TABS: Tab[] = ['send', 'add', 'cards', 'profile', 'receive', 'crypto-send'];

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

export default function WalletPage() {
  const router = useRouter();
  const { user, isDemo, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [avatarState, setAvatarState] = useState<'idle' | 'talking' | 'thinking'>('idle');
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [receiveCoin, setReceiveCoin] = useState<'BTC' | 'ETH' | 'USDT'>('ETH');
  const [cryptoSendCoin, setCryptoSendCoin] = useState<'BTC' | 'ETH' | 'USDT'>('BTC');

  useEffect(() => {
    if (!isLoading && !user && !isDemo) {
      router.replace('/');
    }
  }, [isLoading, user, isDemo, router]);

  if (isLoading || (!user && !isDemo)) {
    return (
      <div
        className="min-h-screen flex items-center justify-center max-w-[430px] mx-auto"
        style={{ backgroundColor: '#080C09' }}
      >
        <div className="w-2 h-2 rounded-full bg-[#00FF7F]" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
        <style>{`@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }`}</style>
      </div>
    );
  }

  const isHome = activeTab === 'home';
  const isChat = activeTab === 'add';
  const showAvatar = isHome || isChat;
  const avatarHeight = isChat ? 160 : 280;
  const showBack = BACK_TABS.includes(activeTab);

  // Which tab to highlight in bottom nav
  const navActive: NavTab = (['home', 'send', 'add', 'cards', 'wallet'] as NavTab[]).includes(activeTab as NavTab)
    ? (activeTab as NavTab)
    : 'home';

  const handleSendCrypto = (symbol: string) => {
    setCryptoSendCoin(symbol as 'BTC' | 'ETH' | 'USDT');
    setActiveTab('crypto-send');
  };

  const handleReceiveCrypto = (symbol: string) => {
    setReceiveCoin(symbol as 'BTC' | 'ETH' | 'USDT');
    setActiveTab('receive');
  };

  return (
    <div
      className="min-h-screen flex flex-col max-w-[430px] mx-auto relative overflow-x-hidden"
      style={{ backgroundColor: '#080C09', paddingBottom: '100px' }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 pt-14 pb-0">
        {showBack ? (
          <button
            onClick={() => setActiveTab('home')}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ backgroundColor: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)', color: '#00FF7F' }}
            aria-label="Назад"
          >
            <BackIcon />
          </button>
        ) : (
          <h1 className="text-xl font-semibold text-white tracking-tight">
            {HEADER_TITLES[activeTab]}
          </h1>
        )}

        {showBack && (
          <h1 className="text-base font-semibold text-white tracking-tight">
            {HEADER_TITLES[activeTab]}
          </h1>
        )}

        {/* Profile / Settings toggle */}
        <button
          type="button"
          onClick={() => setActiveTab(activeTab === 'profile' ? 'home' : 'profile')}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{
            backgroundColor: activeTab === 'profile' ? 'rgba(0,255,127,0.15)' : '#0D1A10',
            border: '1px solid rgba(0,255,127,0.15)',
            color: '#00FF7F',
          }}
          aria-label="Профиль"
        >
          <SettingsIcon />
        </button>
      </header>

      {/* ── Avatar ─────────────────────────────────────────── */}
      {showAvatar && (
        <div style={{ transition: 'height 0.4s ease', height: avatarHeight, flexShrink: 0 }}>
          <NeuraAvatar state={avatarState} />
        </div>
      )}

      {/* ── Home ───────────────────────────────────────────── */}
      {activeTab === 'home' && (
        <>
          <BalanceCard />
          <TransferButton
            onSend={() => setActiveTab('send')}
            onReceive={() => setActiveTab('receive')}
          />

          {!insightDismissed && (
            <div className="mx-6 mb-4">
              <div
                className="rounded-2xl p-4"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,255,127,0.08) 0%, rgba(0,255,127,0.03) 100%)',
                  border: '1px solid rgba(0,255,127,0.2)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'rgba(0,255,127,0.15)', border: '1px solid rgba(0,255,127,0.3)' }}
                  >
                    <span className="text-[#00FF7F] text-xs font-bold">N</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-[#00FF7F] text-[10px] font-semibold mb-1 uppercase tracking-wider">Нейра · Инсайт</p>
                    <p className="text-white text-sm leading-relaxed">
                      BTC +4.2% сегодня — твои €2 310 прибавили €93. И есть аномалия: двойное списание Netflix €15.99.
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => setActiveTab('add')}
                        className="text-[#00FF7F] text-xs font-semibold"
                      >
                        Спросить Нейру →
                      </button>
                      <button
                        onClick={() => setInsightDismissed(true)}
                        className="text-[#3A6045] text-xs"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <section className="px-6">
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold text-sm" style={{ color: '#00FF7F' }}>Транзакции</p>
              <MiniChart width={120} height={40} />
            </div>
            <TxHistory limit={7} />
          </section>
        </>
      )}

      {/* ── Send (fiat) ─────────────────────────────────────── */}
      {activeTab === 'send' && (
        <SendScreen onAvatarState={setAvatarState} />
      )}

      {/* ── Нейра Chat ─────────────────────────────────────── */}
      {activeTab === 'add' && (
        <NeuraChat onAvatarState={setAvatarState} avatarHeight={160} />
      )}

      {/* ── Cards (virtual card) ────────────────────────────── */}
      {activeTab === 'cards' && <CardsScreen />}

      {/* ── Wallet / Crypto Assets ─────────────────────────── */}
      {activeTab === 'wallet' && (
        <WalletScreen
          onSendCrypto={handleSendCrypto}
          onReceiveCrypto={handleReceiveCrypto}
        />
      )}

      {/* ── Profile / Settings ─────────────────────────────── */}
      {activeTab === 'profile' && <ProfileScreen />}

      {/* ── Receive Crypto ─────────────────────────────────── */}
      {activeTab === 'receive' && (
        <ReceiveScreen initialNetwork={receiveCoin} />
      )}

      {/* ── Send Crypto ────────────────────────────────────── */}
      {activeTab === 'crypto-send' && (
        <CryptoSendScreen initialCoin={cryptoSendCoin} onAvatarState={setAvatarState} />
      )}

      {/* ── Bottom Nav ─────────────────────────────────────── */}
      <BottomNav active={navActive} onTabChange={(t) => setActiveTab(t)} />
    </div>
  );
}
