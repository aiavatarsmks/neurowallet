import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { neuroIdFromUserId, syncMyNeuroDirectory } from '@/lib/neuro-id';
import SecurityCenter from '@/components/SecurityCenter';
import NotificationsInbox from '@/components/NotificationsInbox';
import NotificationSettings from '@/components/NotificationSettings';
import PolicySettings from '@/components/PolicySettings';
import { explorerUrlForAsset, SUPPORTED_ASSETS, type AssetAddressKey } from '@/lib/crypto/assets';
import { useLanguage } from '@/contexts/LanguageContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useDisplayCurrency, type DisplayCurrency } from '@/contexts/DisplayCurrencyContext';

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
  const { t } = useLanguage();
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
      {copied ? t('profileCopied') : t('profileCopy')}
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

const TelegramBadge = () => (
  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,132,255,0.1)', border: '1px solid rgba(0,132,255,0.25)' }}>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="#0084ff"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.01 9.475c-.148.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.216-3.053 5.56-5.023c.242-.215-.053-.334-.374-.12L7.16 14.78l-2.96-.924c-.644-.2-.657-.644.136-.954l11.56-4.457c.537-.194 1.006.131.666.803z"/></svg>
    <span className="text-[#0084ff] text-[10px] font-semibold">Telegram</span>
  </div>
);

const DEMO_ADDRESSES = {
  eth: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  sol: 'AkELM1tRiHF9PMeRxSgD5UG4v7P3MtNzL8kqSEEtPkX',
  btc: 'bc1q742d35cc6634c0532925a3b844bc454e4438f44',
  tron: 'TQn9Y2khDD95AoRQBkz8ZJXsF9wdDXqcfF',
  ton: 'EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3M',
};

export const ProfileScreen: React.FC = () => {
  const router = useRouter();
  const { user, isDemo, signOut } = useAuth();
  const { t } = useLanguage();
  const { currency, setCurrency } = useDisplayCurrency();

  const [ethAddr,  setEthAddr]  = useState('');
  const [solAddr,  setSolAddr]  = useState('');
  const [btcAddr,  setBtcAddr]  = useState('');
  const [tronAddr, setTronAddr] = useState('');
  const [tonAddr,  setTonAddr]  = useState('');
  const [hasWallet, setHasWallet] = useState(false);
  const [tgUsername,  setTgUsername]  = useState('');
  const [tgFirstName, setTgFirstName] = useState('');
  const [tgPhotoUrl,  setTgPhotoUrl]  = useState('');
  const [neuroId, setNeuroId] = useState('');
  const [neuroIdSyncState, setNeuroIdSyncState] = useState<'idle' | 'synced' | 'pending'>('idle');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDemo) {
      setEthAddr(DEMO_ADDRESSES.eth);
      setSolAddr(DEMO_ADDRESSES.sol);
      setBtcAddr(DEMO_ADDRESSES.btc);
      setTronAddr(DEMO_ADDRESSES.tron);
      setTonAddr(DEMO_ADDRESSES.ton);
      setHasWallet(true);
      setTgUsername('');
      setTgFirstName('');
      setTgPhotoUrl('');
      setNeuroId('nw-demo-user');
      setNeuroIdSyncState('synced');
      return;
    }
    const eth  = localStorage.getItem('wallet_eth_address')  || '';
    const sol  = localStorage.getItem('wallet_sol_address')  || '';
    const btc  = localStorage.getItem('wallet_btc_address')  || '';
    const tron = localStorage.getItem('wallet_tron_address') || '';
    const ton  = localStorage.getItem('wallet_ton_address')  || '';
    setEthAddr(eth);
    setSolAddr(sol);
    setBtcAddr(btc);
    setTronAddr(tron);
    setTonAddr(ton);
    setHasWallet(!!eth);
    setTgUsername(localStorage.getItem('tg_username')   || '');
    setTgFirstName(localStorage.getItem('tg_first_name') || '');
    setTgPhotoUrl(localStorage.getItem('tg_photo_url')  || '');

    if (user?.id) {
      const localNeuroId = neuroIdFromUserId(user.id);
      setNeuroId(localNeuroId);

      const nameForDirectory =
        localStorage.getItem('tg_first_name') ||
        user.name ||
        user.email ||
        'NeuroWallet user';

      syncMyNeuroDirectory(nameForDirectory)
        .then((row) => {
          setNeuroId(row?.neuro_id ?? localNeuroId);
          setNeuroIdSyncState(row ? 'synced' : 'pending');
        })
        .catch(() => setNeuroIdSyncState('pending'));
    }
  }, [user, isDemo]);

  const isTgUser    = !!tgUsername || !!localStorage.getItem?.('tg_user_id');
  const displayName = isDemo
    ? 'Demo Mode'
    : tgFirstName || (user?.name ?? user?.email ?? t('profileDefaultUser'));
  const displaySub  = tgUsername
    ? `@${tgUsername}`
    : isDemo ? 'demo@neurowallet.ai' : (user?.email ?? '');
  const initials    = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = () => { signOut(); router.replace('/'); };
  const addressByKey: Record<AssetAddressKey, string> = {
    btc: btcAddr,
    eth: ethAddr,
    sol: solAddr,
    tron: tronAddr,
    ton: tonAddr,
  };

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
        {tgPhotoUrl ? (
          <img src={tgPhotoUrl} alt="" className="w-16 h-16 rounded-full object-cover flex-shrink-0" style={{ border: '2px solid rgba(0,132,255,0.4)' }} />
        ) : (
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{ background: 'rgba(0,255,127,0.12)', border: '2px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
          >
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-base truncate">{displayName}</p>
          <p className="text-[#3A6045] text-xs mt-0.5 truncate" style={tgUsername ? { color: '#0084ff' } : {}}>
            {displaySub}
          </p>
          <div className="mt-2">
            {tgUsername ? <TelegramBadge /> : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.2)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-[#00FF7F]" />
                <span className="text-[#00FF7F] text-[10px] font-semibold">NeuroWallet MVP</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {neuroId && (
        <div
          className="rounded-2xl p-4"
          style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <p className="text-white text-sm font-semibold">NeuroID</p>
              <p className="text-[#3A6045] text-xs mt-0.5">
                {t('profileNeuroIdSubtitle')}
              </p>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: neuroIdSyncState === 'synced' ? 'rgba(0,255,127,0.1)' : 'rgba(245,158,11,0.08)',
                color: neuroIdSyncState === 'synced' ? '#00FF7F' : '#f59e0b',
              }}
            >
              {neuroIdSyncState === 'synced' ? t('profileActive') : t('profileLocal')}
            </span>
          </div>
          <p className="text-white text-sm font-mono mb-3">{neuroId}</p>
          <CopyButton text={neuroId} />
          <p className="text-[#3A6045] text-xs mt-3 leading-relaxed">
            {t('profileNeuroIdHint')}
          </p>
        </div>
      )}

      {/* Wallet addresses */}
      {hasWallet ? (
        <div>
          <p className="text-white text-sm font-semibold mb-3">{t('profileAddressesTitle')}</p>
          <div className="flex flex-col gap-2">
            {SUPPORTED_ASSETS.map((asset) => {
              const address = addressByKey[asset.addressKey];
              return (
                <AddressRow
                  key={asset.symbol}
                  label={asset.addressLabel}
                  icon={asset.icon}
                  color={asset.color}
                  address={address}
                  explorerUrl={explorerUrlForAsset(asset, address)}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.1)' }}
        >
          <p className="text-[#3A6045] text-sm">{t('profileNoWallet')}</p>
        </div>
      )}

      {/* Security */}
      <div>
        <p className="text-white text-sm font-semibold mb-3">{t('profileSecurityTitle')}</p>
        <div className="flex flex-col gap-2">
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
          >
            <span style={{ color: '#00FF7F' }}><ShieldIcon /></span>
            <div className="flex-1">
              <p className="text-white text-sm">{t('profileKeyStorage')}</p>
              <p className="text-[#3A6045] text-xs mt-0.5">{t('profileKeyStorageDesc')}</p>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,255,127,0.1)', color: '#00FF7F' }}
            >
              {t('profileLocalBadge')}
            </span>
          </div>

          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.08)' }}
          >
            <span style={{ color: '#3A6045' }}><KeyIcon /></span>
            <div className="flex-1">
              <p className="text-white text-sm">{t('profilePrivateKeys')}</p>
              <p className="text-[#3A6045] text-xs mt-0.5">{t('profilePrivateKeysDesc')}</p>
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,255,127,0.1)', color: '#00FF7F' }}
            >
              {t('profileOnlyYouBadge')}
            </span>
          </div>
        </div>
      </div>

      {/* In-app inbox (задача 2.4) — renders nothing when empty/demo */}
      <NotificationsInbox />

      {/* Preference center (задача 2.4) — renders nothing when flag off/demo */}
      <NotificationSettings />

      {/* Policy Engine permissions (задача 3.1) — renders nothing when flag off/demo */}
      <PolicySettings />

      {/* Security center lite (задача 1.6) */}
      <SecurityCenter />

      {/* Neira trust level */}
      <div className="rounded-2xl p-4" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <div className="flex justify-between items-center mb-3">
          <p className="text-white text-sm font-semibold">{t('profileTrustLevel')}</p>
          <span className="text-[#00FF7F] text-xs font-bold">{t('profileTrustMedium')}</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,127,0.1)' }}>
          <div
            className="absolute left-0 top-0 h-full rounded-full"
            style={{ width: '60%', background: 'linear-gradient(to right, #00CC60, #00FF7F)', boxShadow: '0 0 8px rgba(0,255,127,0.5)' }}
          />
        </div>
        <p className="text-[#3A6045] text-xs mt-2">
          {t('profileTrustDesc')}
        </p>
      </div>

      {/* Language */}
      <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <p className="text-white text-sm font-semibold">{t('profileLanguage')}</p>
        <LanguageSwitcher />
      </div>

      {/* Display currency */}
      <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
        <p className="text-white text-sm font-semibold">{t('profileDisplayCurrency')}</p>
        <div className="flex rounded-2xl p-1" style={{ background: '#08120B', border: '1px solid rgba(0,255,127,0.12)' }}>
          {(['EUR', 'USD'] as DisplayCurrency[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCurrency(item)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
              style={currency === item
                ? { background: 'rgba(0,255,127,0.16)', color: '#00FF7F' }
                : { background: 'transparent', color: '#3A6045' }}
            >
              {item === 'USD' ? '$ USD' : '€ EUR'}
            </button>
          ))}
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-95"
        style={{ background: 'transparent', border: '1px solid rgba(255,59,48,0.3)', color: '#ff3b30' }}
      >
        {isDemo ? t('profileSignOutDemo') : t('profileSignOutReal')}
      </button>
    </div>
  );
};

export default ProfileScreen;
