import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PinEntry } from '@/components/PinEntry';
import { PinSetup } from '@/components/PinSetup';
import { hasPinSetup, verifyWalletPassword } from '@/lib/pin';
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
type PinGate = 'checking' | 'locked' | 'setup-required' | 'open';

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

const WALLET_RESET_KEYS = [
  'wallet_eth_address', 'wallet_sol_address', 'wallet_btc_address',
  'wallet_tron_address', 'wallet_ton_address', 'wallet_keystore',
  'wallet_sol_enc', 'wallet_btc_enc', 'wallet_tron_enc', 'wallet_ton_enc',
  'wallet_pin_blob', 'wallet_pin_attempts', 'wallet_pin_lockout_until',
  'wallet_sol_xor', 'wallet_btc_xor', 'wallet_tron_xor', 'wallet_ton_xor',
];

const RequiredPinSetupGate: React.FC<{ onReady: (walletPassword: string) => void }> = ({ onReady }) => {
  const router = useRouter();
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [verifiedPassword, setVerifiedPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);

  const submit = async () => {
    if (!password || checking) return;
    setChecking(true);
    setError(false);
    const ok = await verifyWalletPassword(password);
    setChecking(false);
    if (!ok) { setError(true); return; }
    setVerifiedPassword(password);
    setPassword('');
  };

  const resetLocalWallet = () => {
    for (const key of WALLET_RESET_KEYS) localStorage.removeItem(key);
    router.push('/onboarding');
  };

  if (verifiedPassword) {
    return (
      <PinSetup
        walletPassword={verifiedPassword}
        allowSkip={false}
        onComplete={() => onReady(verifiedPassword)}
      />
    );
  }

  return (
    <main
      data-testid="pin-setup-required"
      className="min-h-screen flex flex-col justify-center max-w-[430px] mx-auto px-6"
      style={{ backgroundColor: '#080C09' }}
    >
      <div className="flex flex-col gap-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.25)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00FF7F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>

        <div>
          <h1 className="text-white text-2xl font-bold leading-tight">{t('pinSetupRequiredTitle')}</h1>
          <p className="text-[#3A6045] text-sm leading-relaxed mt-2">{t('pinSetupRequiredText')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('secPinPasswordPh')}
            className="w-full rounded-2xl px-4 py-4 text-white text-sm bg-transparent outline-none placeholder:text-[#3A6045]"
            style={{
              background: '#0D1A10',
              border: `1px solid ${error ? 'rgba(255,59,48,0.5)' : 'rgba(0,255,127,0.16)'}`,
              caretColor: '#00FF7F',
            }}
          />
          {error && <p className="text-xs" style={{ color: '#FF453A' }}>{t('secPinWrongPassword')}</p>}

          <button
            onClick={submit}
            disabled={checking || !password}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.28)' }}
          >
            {checking ? '…' : t('pinSetupRequiredCta')}
          </button>

          <button
            onClick={() => router.push('/onboarding?recover=1')}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: 'transparent', border: '1px solid rgba(0,255,127,0.18)', color: '#00FF7F' }}
          >
            {t('pinSetupRecoverCta')}
          </button>

          <button
            onClick={resetLocalWallet}
            className="w-full py-3 text-xs font-semibold"
            style={{ color: '#F7931A' }}
          >
            {t('pinSetupResetCta')}
          </button>
        </div>
      </div>
    </main>
  );
};

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
  // Fail-closed PIN gate. 'checking' = status not yet resolved → render a
  // loading placeholder, NEVER wallet content (deny-by-default per CLAUDE.md).
  // Only ever moves to 'open' after localStorage has been read on the client.
  const [pinGate, setPinGate] = useState<PinGate>('checking');
  const [walletPassword, setWalletPassword] = useState<string | null>(null);
  const [receiveCoin, setReceiveCoin] = useState<ReceiveNetwork>('ETH');
  const [cryptoSendCoin, setCryptoSendCoin] = useState<CryptoSendCoin>('ETH');
  const [cryptoSendDraft, setCryptoSendDraft] = useState<CryptoSendDraft | null>(null);

  useEffect(() => {
    if (!isLoading && !user && !isDemo) {
      router.replace('/');
    }
  }, [isLoading, user, isDemo, router]);

  // Resolve the PIN gate. Fail-closed: the gate starts 'checking' and access
  // stays CLOSED until this effect has actually read localStorage. We never
  // default to 'open' during the async window — that would leak wallet content
  // before the gate is decided (the observed "PIN не спросил, сразу пустил"
  // race). localStorage is synchronous, so once we reach the read the status
  // is definitive.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) { setPinGate('open'); return; }
    if (isLoading || !user) return; // wait for auth; stay 'checking' (closed)

    const hasWallet = !!localStorage.getItem('wallet_eth_address');
    if (!hasWallet) {
      // Пустой localStorage при живой сессии (смена origin, новое устройство,
      // очистка данных) — ведём на восстановление. Остаёмся 'checking', чтобы
      // контент кошелька не мелькнул во время редиректа.
      router.replace('/onboarding');
      return;
    }
    // Wallet present: never open an unprotected real wallet. If PIN is missing,
    // force setup/recovery before any wallet content is rendered.
    if (!hasPinSetup()) {
      setPinGate('setup-required');
      return;
    }
    setPinGate(walletPassword === null ? 'locked' : 'open');
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

  // Fail-closed loading gate: render the placeholder — never wallet content —
  // until BOTH auth is resolved AND the PIN gate status is known ('checking').
  if (isLoading || (!user && !isDemo) || (!isDemo && pinGate === 'checking')) {
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

  // PIN gate — shown when the wallet is locked (PIN configured, not unlocked).
  if (!isDemo && pinGate === 'locked' && walletPassword === null) {
    return (
      <PinEntry
        onSuccess={(pwd) => {
          setWalletPassword(pwd);
          setPinGate('open');
        }}
      />
    );
  }

  if (!isDemo && pinGate === 'setup-required') {
    return (
      <RequiredPinSetupGate
        onReady={(pwd) => {
          setWalletPassword(pwd);
          setPinGate('open');
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
