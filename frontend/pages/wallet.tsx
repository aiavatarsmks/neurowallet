import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { PinEntry } from '@/components/PinEntry';
import { hasPinSetup } from '@/lib/pin';
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
  const [chatHasMessages, setChatHasMessages] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [walletPassword, setWalletPassword] = useState<string | null>(null);
const [receiveCoin, setReceiveCoin] = useState<'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TON' | 'TRX'>('ETH');
  const [cryptoSendCoin, setCryptoSendCoin] = useState<'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TON' | 'TRC20' | 'USDT_TON'>('ETH');

  useEffect(() => {
    if (!isLoading && !user && !isDemo) {
      router.replace('/');
    }
  }, [isLoading, user, isDemo, router]);

  // Check if PIN gate is needed (wallet exists + PIN set up + not yet unlocked)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasWallet = !!localStorage.getItem('wallet_eth_address');
    if (hasWallet && hasPinSetup() && walletPassword === null) {
      setPinRequired(true);
    }
  }, [walletPassword]);

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

  // PIN gate — shown when wallet is locked
  if (pinRequired && walletPassword === null) {
    return (
      <PinEntry
        onSuccess={(pwd) => {
          setWalletPassword(pwd);
          setPinRequired(false);
        }}
      />
    );
  }

  const isHome = activeTab === 'home';
  const isChat = activeTab === 'add';
  const showAvatar = isHome || isChat;
  const chatAvatarHeight = chatHasMessages ? 64 : 160;
  const avatarHeight = isHome ? 280 : chatAvatarHeight;
  const showBack = BACK_TABS.includes(activeTab);

  // Which tab to highlight in bottom nav
  const navActive: NavTab = (['home', 'send', 'add', 'cards', 'wallet'] as NavTab[]).includes(activeTab as NavTab)
    ? (activeTab as NavTab)
    : 'home';

  const handleSendCrypto = (symbol: string) => {
    const sendMap: Record<string, string> = { 'USDT_TRC': 'TRC20' };
    const coin = (sendMap[symbol] ?? symbol) as 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TON' | 'TRC20' | 'USDT_TON';
    setCryptoSendCoin(coin);
    setActiveTab('crypto-send');
  };

  const handleReceiveCrypto = (symbol: string) => {
    const map: Record<string, string> = {
      'USDT_TRC': 'TRX',
      'USDT_TON': 'TON',
      'USDT': 'USDT',
    };
    const net = (map[symbol] ?? symbol) as 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TON' | 'TRX';
    setReceiveCoin(net);
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
        <div style={{ transition: 'height 0.4s ease', height: avatarHeight, flexShrink: 0, overflow: 'hidden' }}>
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
        <NeuraChat
          onAvatarState={setAvatarState}
          avatarHeight={chatAvatarHeight}
          onFirstMessage={() => setChatHasMessages(true)}
        />
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
