/**
 * components/SecurityCenter.tsx — security center lite (задача 1.6).
 * Секция профиля: статус PIN, устройства, лента security-событий,
 * «выйти на других устройствах» (мгновенный revoke через Supabase).
 * Демо-режим: секция скрыта (нет сессии/данных).
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { hasPinSetup, verifyWalletPassword } from '@/lib/pin';
import { track } from '@/lib/analytics';
import { PinSetup } from '@/components/PinSetup';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface Device {
  id: string;
  ua_label: string | null;
  last_seen: string;
}

interface FeedEvent {
  action: string;
  created_at: string;
  meta: Record<string, unknown>;
}

const ACTION_ICON: Record<string, string> = {
  tg_auth_login: '🔑',
  risk_flagged: '🛡',
  risk_override_confirmed: '⚠️',
  tx_draft_created: '📝',
  tx_draft_updated: '📤',
  payment_request_created: '🔗',
  payment_request_updated: '🔗',
  contact_saved: '👤',
  contact_deleted: '👤',
};

function shortUa(label: string | null): string {
  if (!label) return 'Unknown device';
  if (/Telegram/i.test(label)) return 'Telegram';
  if (/iPhone|iPad/i.test(label)) return 'iOS';
  if (/Android/i.test(label)) return 'Android';
  if (/Macintosh/i.test(label)) return 'macOS';
  if (/Windows/i.test(label)) return 'Windows';
  return label.slice(0, 24);
}

export const SecurityCenter: React.FC = () => {
  const { isDemo, user } = useAuth();
  const { t } = useLanguage();
  const [pinOn, setPinOn] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [revoked, setRevoked] = useState(false);

  // Флоу установки/смены PIN: пароль кошелька → PinSetup (overlay).
  const [hasWallet, setHasWallet]   = useState(false);
  const [pinFlow, setPinFlow]       = useState<'none' | 'password' | 'setup'>('none');
  const [pwInput, setPwInput]       = useState('');
  const [pwError, setPwError]       = useState(false);
  const [pwChecking, setPwChecking] = useState(false);
  const [verifiedPw, setVerifiedPw] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPinOn(hasPinSetup());
    setHasWallet(!!localStorage.getItem('wallet_eth_address'));
  }, []);

  const submitPinPassword = async () => {
    if (pwChecking || !pwInput) return;
    setPwChecking(true);
    setPwError(false);
    const ok = await verifyWalletPassword(pwInput);
    setPwChecking(false);
    if (!ok) { setPwError(true); return; }
    setVerifiedPw(pwInput);
    setPwInput('');
    setPinFlow('setup');
  };

  const closePinFlow = (saved: boolean) => {
    setVerifiedPw('');
    setPwInput('');
    setPinFlow('none');
    if (saved) setPinOn(true);
  };

  useEffect(() => {
    if (isDemo || !user) return;
    let cancelled = false;
    (async () => {
      try {
        // Устройства — напрямую под RLS (select only own).
        const { data: devs } = await supabase
          .from('devices')
          .select('id, ua_label, last_seen')
          .order('last_seen', { ascending: false })
          .limit(10);
        if (!cancelled && Array.isArray(devs)) setDevices(devs as Device[]);

        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        if (!token) return;
        const r = await fetch('/api/security-feed', { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json().catch(() => null);
        if (!cancelled && Array.isArray(body?.events)) setFeed(body.events);
      } catch { /* секция опциональна */ }
    })();
    return () => { cancelled = true; };
  }, [isDemo, user]);

  const revokeOthers = async () => {
    try {
      await supabase.auth.signOut({ scope: 'others' });
      setRevoked(true);
      track('sessions_revoked');
      setTimeout(() => setRevoked(false), 3000);
    } catch { /* ignore */ }
  };

  if (isDemo || !user) return null;

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
      <p className="text-white text-sm font-semibold">{t('secTitle')}</p>

      {/* PIN статус + установка/смена */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[#3A6045] text-xs">{t('secPinStatus')}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={pinOn ? { background: 'rgba(0,255,127,0.1)', color: '#00FF7F' } : { background: 'rgba(247,147,26,0.1)', color: '#F7931A' }}>
            {pinOn ? t('secPinOn') : t('secPinOff')}
          </span>
          {hasWallet && pinFlow === 'none' && (
            <button
              onClick={() => { setPinFlow('password'); setPwError(false); }}
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(0,255,127,0.08)', border: '1px solid rgba(0,255,127,0.25)', color: '#00FF7F' }}
            >
              {pinOn ? t('secChangePin') : t('secSetPin')}
            </button>
          )}
        </div>
      </div>

      {/* Шаг пароля для установки/смены PIN */}
      {pinFlow === 'password' && (
        <div className="flex flex-col gap-2">
          <p className="text-[#3A6045] text-xs">{t('secPinPasswordHint')}</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={pwInput}
              onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
              onKeyDown={(e) => e.key === 'Enter' && submitPinPassword()}
              placeholder={t('secPinPasswordPh')}
              className="flex-1 rounded-xl px-3 py-2.5 text-white text-sm bg-transparent outline-none"
              style={{ background: '#101f14', border: `1px solid ${pwError ? 'rgba(255,59,48,0.5)' : 'rgba(0,255,127,0.1)'}`, caretColor: '#00FF7F' }}
            />
            <button
              onClick={submitPinPassword}
              disabled={pwChecking || !pwInput}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
              style={{ background: '#00FF7F', color: '#080C09' }}
            >
              {pwChecking ? '…' : 'OK'}
            </button>
            <button
              onClick={() => closePinFlow(false)}
              className="px-3 py-2.5 rounded-xl text-xs"
              style={{ border: '1px solid rgba(0,255,127,0.15)', color: '#3A6045' }}
            >
              ✕
            </button>
          </div>
          {pwError && <p className="text-xs" style={{ color: '#FF453A' }}>{t('secPinWrongPassword')}</p>}
        </div>
      )}

      {/* Overlay установки PIN (полноэкранный PinSetup) */}
      {pinFlow === 'setup' && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: '#080C09' }}>
          <PinSetup
            walletPassword={verifiedPw}
            onComplete={() => closePinFlow(true)}
            onSkip={() => closePinFlow(false)}
          />
        </div>
      )}

      {/* Устройства */}
      {devices.length > 0 && (
        <div>
          <p className="text-[#3A6045] text-xs mb-1.5">{t('secDevices')}</p>
          <div className="flex flex-col gap-1">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-xs">
                <span className="text-white">{shortUa(d.ua_label)}</span>
                <span className="text-[#3A6045]">{new Date(d.last_seen).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Security feed */}
      {feed.length > 0 && (
        <div>
          <p className="text-[#3A6045] text-xs mb-1.5">{t('secFeed')}</p>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {feed.slice(0, 10).map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span>{ACTION_ICON[e.action] ?? '•'}</span>
                <span className="text-white flex-1 truncate">
                  {t(`secEvent_${e.action}` as Parameters<typeof t>[0])}
                  {typeof e.meta.coin === 'string' ? ` · ${e.meta.coin}` : ''}
                </span>
                <span className="text-[#3A6045]">
                  {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revoke */}
      <button
        onClick={revokeOthers}
        className="w-full py-3 rounded-xl text-xs font-semibold transition-all active:scale-95"
        style={{ background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.25)', color: '#F7931A' }}
      >
        {revoked ? t('secRevoked') : t('secRevokeOthers')}
      </button>
    </div>
  );
};

export default SecurityCenter;
