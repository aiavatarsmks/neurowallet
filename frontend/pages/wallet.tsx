import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PinEntry } from '@/components/PinEntry';
import { hasPinSetup } from '@/lib/pin';
import { BalanceCard } from '@/components/BalanceCard';
import { DemoGuide } from '@/components/DemoGuide';
import { completeDemoTask } from '@/lib/demo-guide';
import { TxHistory } from '@/components/TxHistory';
import { TransferButton } from '@/components/TransferButton';
import { BottomNav } from '@/components/BottomNav';
import { MiniChart } from '@/components/MiniChart';
import { SendScreen } from '@/components/SendScreen';
import { NeuraChat } from '@/components/NeuraChat';
import { ProfileScreen } from '@/components/ProfileScreen';
import { CardsScreen } from '@/components/CardsScreen';
import { WalletScreen } from '@/components/WalletScreen';
import { ReceiveScreen, type ReceiveNetwork } from '@/components/ReceiveScreen';
import { CryptoSendScreen } from '@/components/CryptoSendScreen';

const NeuraAvatar = dynamic(
  () => import('@/components/NeuraAvatar').then((m) => m.NeuraAvatar),
  { ssr: false, loading: () => <div style={{ height: 280 }} /> }
);

type NavTab = 'home' | 'send' | 'add' | 'cards' | 'wallet';
type Tab = NavTab | 'profile' | 'receive' | 'crypto-send';
type CryptoSendCoin = 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'TON' | 'TRX' | 'TRC20' | 'USDT_TON';

interface CryptoSendDraft {
  coin: CryptoSendCoin;
  address: string;
  amount: string;
  recipientName: string;
  neuroId?: string;
}

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
  const { t } = useLanguage();
  const { user, isDemo, isLoading } = useAuth();
  const HEADER_TITLES: Record<Tab, string> = {
    home:          t('headerHome'),
    send:          t('headerSend'),
    add:           t('headerNeura'),
    cards:         t('headerCards'),
    wallet:        t('headerWallet'),
    profile:       t('headerProfile'),
    receive:       t('headerReceive'),
    'crypto-send': t('headerCryptoSend'),
  };
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [avatarState, setAvatarState] = useState<'idle' | 'talking' | 'thinking'>('idle');
  const [chatHasMessages, setChatHasMessages] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [walletPassword, setWalletPassword] = useState<string | null>(null);
  const [receiveCoin, setReceiveCoin] = useState<ReceiveNetwork>('ETH');
  const [cryptoSendCoin, setCryptoSendCoin] = useState<CryptoSendCoin>('ETH');
  const [cryptoSendDraft, setCryptoSendDraft] = useState<CryptoSendDraft | null>(null);

  useEffect(() => {
    if (!isLoading && !user && !isDemo) {
      router.replace('/');
    }
  }, [isLoading, user, isDemo, router]);

  // Check if PIN gate is needed (wallet exists + PIN set up + not yet unlocked)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) {
      setPinRequired(false);
      return;
    }
    const hasWallet = !!localStorage.getItem('wallet_eth_address');
    if (hasWallet && hasPinSetup() && walletPassword === null) {
      setPinRequired(true);
    }
    // Пустой localStorage при живой сессии (смена origin, новое устройство,
    // очистка данных) — не молчим с пустыми экранами, а ведём на
    // восстановление: onboarding предлагает создать или переимпортировать seed.
    if (!hasWallet && user && !isLoading) {
      router.replace('/onboarding');
    }
  }, [isDemo, walletPassword, user, isLoading, router]);

  // Demo-воронка (задача 1.8): отметки задач гида при посещении экранов.
  // ВАЖНО: этот хук ОБЯЗАН объявляться ДО любых ранних return ниже. Иначе
  // при переходе на PIN-gate (pinRequired: false→true сразу после fresh
  // import с установленным PIN) render с ранним return вызывает на один хук
  // меньше предыдущего → React error #300 «Rendered fewer hooks».
  useEffect(() => {
    if (!isDemo) return;
    if (activeTab === 'wallet') completeDemoTask('view_portfolio');
    if (activeTab === 'receive') completeDemoTask('open_receive');
  }, [isDemo, activeTab]);

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
  if (!isDemo && pinRequired && walletPassword === null) {
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
    const coin = (sendMap[symbol] ?? symbol) as CryptoSendCoin;
    setCryptoSendDraft(null);
    setCryptoSendCoin(coin);
    setActiveTab('crypto-send');
  };

  const handleSendCryptoTransfer = (draft: CryptoSendDraft) => {
    setCryptoSendCoin(draft.coin);
    setCryptoSendDraft(draft);
    setActiveTab('crypto-send');
  };

  const handleReceiveCrypto = (symbol: string) => {
    const map: Record<string, string> = {
      'USDT_TRC': 'TRC20',
      'USDT_TON': 'USDT_TON',
      'USDT': 'USDT',
    };
    const net = (map[symbol] ?? symbol) as ReceiveNetwork;
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
            aria-label={t('ariaBack')}
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
          aria-label={t('ariaProfile')}
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
          <DemoGuide />
          <BalanceCard />
          <TransferButton
            onSend={() => setActiveTab('send')}
            onReceive={() => setActiveTab('receive')}
          />

          {/* Нейра инсайт — только в демо-режиме */}
          {isDemo && (
            <div
              className="mx-6 rounded-2xl p-4 flex gap-3 items-start"
              style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.15)' }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(0,255,127,0.12)' }}
              >
                <span className="text-xs">✨</span>
              </div>
              <div>
                <p className="text-[#00FF7F] text-xs font-semibold mb-0.5">{t('navNeura')}</p>
                <p className="text-white text-sm leading-relaxed">
                  {(() => {
                    const text = t('neuraInsightText');
                    const parts = text.split('+4.2%');
                    return (
                      <>
                        {parts[0]}<span style={{ color: '#00FF7F' }}>+4.2%</span>{parts[1]}
                      </>
                    );
                  })()}
                </p>
              </div>
            </div>
          )}

          <section className="px-6">
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold text-sm" style={{ color: '#00FF7F' }}>{t('transactionsHeader')}</p>
              <MiniChart width={120} height={40} />
            </div>
            <TxHistory limit={7} />
          </section>
        </>
      )}

      {/* ── Send (fiat) ─────────────────────────────────────── */}
      {activeTab === 'send' && (
        <SendScreen
          onAvatarState={setAvatarState}
          onSendCryptoTransfer={handleSendCryptoTransfer}
        />
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
        <CryptoSendScreen
          initialCoin={cryptoSendCoin}
          initialAddress={cryptoSendDraft?.address ?? ''}
          initialAmount={cryptoSendDraft?.amount ?? ''}
          recipientName={cryptoSendDraft?.recipientName ?? ''}
          neuroId={cryptoSendDraft?.neuroId ?? ''}
          onAvatarState={setAvatarState}
        />
      )}

      {/* ── Bottom Nav ─────────────────────────────────────── */}
      <BottomNav active={navActive} onTabChange={(t) => setActiveTab(t)} />
    </div>
  );
}
