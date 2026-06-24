import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';

// ─── Icons ────────────────────────────────────────────────────────────────────

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FF7F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const KeyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
  </svg>
);

const ExternalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

// ─── CopyButton ───────────────────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for non-https
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all active:scale-90"
      style={{
        background: copied ? 'rgba(0,255,127,0.12)' : 'rgba(0,255,127,0.06)',
        color: copied ? '#00FF7F' : '#3A6045',
        border: `1px solid ${copied ? 'rgba(0,255,127,0.3)' : 'rgba(0,255,127,0.1)'}`,
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Скопировано' : 'Копировать'}
    </button>
  );
};

// ─── AddressRow ───────────────────────────────────────────────────────────────

interface AddressRowProps {
  label:     string;
  icon:      string;
  color:     string;
  address:   string;
  explorerUrl?: string;
}

const AddressRow: React.FC<AddressRowProps> = ({ label, icon, color, address, explorerUrl }) => {
  if (!address) return null;
  const short = `${address.slice(0, 10)}…${address.slice(-6)}`;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base font-bold" style={{ color }}>{icon}</span>
        <span className="text-[#3A6045] text-xs font-medium uppercase tracking-wider">{label}</span>
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="ml-auto" style={{ color: '#3A6045' }}>
            <ExternalIcon />
          </a>
        )}
      </div>
      <p className="text-white text-xs font-mono mb-2 break-all leading-relaxed">{short}</p>
      <CopyButton text={address} />
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const ProfileScreen: React.FC = () => {
  const router = useRouter();
  const { user, isDemo, signOut } = useAuth();

  const [ethAddr,  setEthAddr]  = useState('');
  const [solAddr,  setSolAddr]  = useState('');
  const [btcAddr,  setBtcAddr]  = useState('');
  const [tronAddr, setTronAddr] = useState('');
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const eth  = localStorage.getItem('wallet_eth_address')  || '';
    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    setEthAddr(eth);
    setSolAddr(sol);
    setBtcAddr(btc);
    setTronAddr(tron);
    setHasWallet(!!eth);
  }, []);

  const displayName  = isDemo ? 'Demo Mode' : (user?.name ?? user?.email ?? 'Пользователь');
  const displayEmail = isDemo ? 'demo@neurowallet.ai' : (user?.email ?? '');
  const initials     = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = () => { signOut(); router.replace('/'); };

  return (
    <div className="px-6 pt-2 pb-6 flex flex-col gap-5">

      {/* Profile card */}
      <div
        className="rounded-3xl p-5 flex items-center gap-4"
        style={{
          background: 'linear-gradient(135deg, #0D1A10 0%, #0A1A12 100%)',
          border: '1px solid rgba(0,255,127,0.12)',
        }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
          style={{ background: 'rgba(0,255,127,0.12)', border: '2px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-base truncate">{displayName}</p>
          <p className="text-[#3A6045] text-xs mt-0.5 truncate">{displayEmail}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-[#00FF7F]" />
            <span className="text-[#00FF7F] text-[10px] font-semibold">NeuroWallet MVP</span>
          </div>
        </div>
      </div>

      {/* Wallet addresses */}
      {hasWallet ? (
        <div>
          <p className="text-white text-sm font-semibold mb-3">Адреса кошелька</p>
          <div className="flex flex-col gap-2">
            <AddressRow
              label="Ethereum / USDT"
              icon="Ξ"
              color="#627EEA"
              address={ethAddr}
              explorerUrl={`https://etherscan.io/address/${ethAddr}`}
            />
            <AddressRow
              label="Solana"
              icon="◎"
              color="#9945FF"
              address={solAddr}
              explorerUrl={`https://solscan.io/account/${solAddr}`}
            />
            <AddressRow
              label="Bitcoin"
              icon="₿"
              color="#F7931A"
              address={btcAddr}
              explorerUrl={`https://blockstream.info/address/${btcAddr}`}
            />
            <AddressRow
              label="USDT TRC-20 (Tron)"
              icon="₮"
              color="#EF0027"
              address={tronAddr}
              explorerUrl={`https://tronscan.org/#/address/${tronAddr}`}
            />
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.1)' }}
        >
          <p className="text-[#3A6045] text-sm">Кошелёк не создан. Пройди онбординг.</p>
        </div>
      )}

      {/* Security */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">Безопасность</p>
        <div className="flex flex-col gap-2">
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
          >
            <span style={{ color: '#00FF7F' }}><ShieldIcon /></span>
            <div className="flex-1">
              <p className="text-white text-sm">Хранение ключей</p>
              <p className="text-[#3A6045] text-xs mt-0.5">Зашифровано на устройстве · AES-256 · scrypt</p>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,255,127,0.1)', color: '#00FF7F' }}
            >
              ✓ Локально
            </span>
          </div>

          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
          >
            <span style={{ color: '#3A6045' }}><KeyIcon /></span>
            <div className="flex-1">
              <p className="text-white text-sm">Приватные ключи</p>
              <p className="text-[#3A6045] text-xs mt-0.5">Никогда не покидают устройство</p>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,255,127,0.1)', color: '#00FF7F' }}
            >
              ✓ Только у тебя
            </span>
          </div>
        </div>
      </div>

      {/* Neira trust level */}
      <div className="rounded-2xl p-4" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <div className="flex justify-between items-center mb-3">
          <p className="text-white text-sm font-semibold">Уровень доверия Нейры</p>
          <span className="text-[#00FF7F] text-xs font-bold">Средний</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,127,0.1)' }}>
          <div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{ width: '60%', background: 'linear-gradient(to right, #00CC60, #00FF7F)', boxShadow: '0 0 8px rgba(0,255,127,0.5)' }}
          />
        </div>
        <p className="text-[#3A6045] text-xs mt-2">
          Нейра даёт советы и аналитику. Для автоматических действий — повысь уровень доверия.
        </p>
      </div>

      {/* Sign out */}
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
