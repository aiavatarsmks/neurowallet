/**
 * components/NotificationSettings.tsx — preference center for the notification
 * engine (задача 2.4). Renders nothing in demo, signed-out, or when the engine
 * feature flag is off — so it can never break the profile page or leak the
 * feature before activation. Lets the user pick channels, types, and quiet hours;
 * the backend enforces these (see lib/server/notification-engine.ts).
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { notificationsEngineEnabled } from '@/lib/notifications-config';
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/notifications-client';

const minToTime = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMin = (v: string): number => {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

const Toggle: React.FC<{ on: boolean; onClick?: () => void; disabled?: boolean }> = ({ on, onClick, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    aria-pressed={on}
    className="relative w-10 h-6 rounded-full transition-colors"
    style={{ background: on ? 'rgba(0,255,127,0.35)' : 'rgba(255,255,255,0.1)', opacity: disabled ? 0.5 : 1 }}
  >
    <span
      className="absolute top-0.5 w-5 h-5 rounded-full transition-transform"
      style={{ background: on ? '#00FF7F' : '#6b7280', transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
    />
  </button>
);

export const NotificationSettings: React.FC = () => {
  const { isDemo, user } = useAuth();
  const { t } = useLanguage();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isDemo || !user || !notificationsEngineEnabled()) return;
    getNotificationPrefs().then((p) => p && setPrefs(p));
  }, [isDemo, user]);

  if (isDemo || !user || !notificationsEngineEnabled() || !prefs) return null;

  const persist = (next: NotificationPrefs) => {
    // Stamp the user's current UTC offset so quiet hours are evaluated locally.
    next.tz_offset_min = -new Date().getTimezoneOffset();
    setPrefs(next);
    setSaved(false);
    saveNotificationPrefs(next).then((r) => {
      if (r) {
        setPrefs(r);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  };

  const set = (patch: Partial<NotificationPrefs>) => persist({ ...prefs, ...patch });

  const Row: React.FC<{ label: string; value: boolean; locked?: boolean; onToggle: () => void }> = ({ label, value, locked, onToggle }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-white text-xs">{label}</span>
      {locked ? (
        <span className="text-[10px] font-semibold" style={{ color: '#00FF7F' }}>{t('notifSecurityLocked')}</span>
      ) : (
        <Toggle on={value} onClick={onToggle} />
      )}
    </div>
  );

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-white text-sm font-semibold">{t('notifSettingsTitle')}</p>
        {saved && <span className="text-[10px] font-semibold" style={{ color: '#00FF7F' }}>{t('notifSaved')}</span>}
      </div>

      <Row label={t('notifChannelTelegram')} value={prefs.telegram_enabled} onToggle={() => set({ telegram_enabled: !prefs.telegram_enabled })} />

      <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

      <Row label={t('notifTypeTransactional')} value={prefs.transactional_enabled} onToggle={() => set({ transactional_enabled: !prefs.transactional_enabled })} />
      <Row label={t('notifTypeSecurity')} value locked onToggle={() => {}} />
      <Row label={t('notifTypePrice')} value={prefs.price_enabled} onToggle={() => set({ price_enabled: !prefs.price_enabled })} />
      <Row label={t('notifTypePromo')} value={prefs.promotional_enabled} onToggle={() => set({ promotional_enabled: !prefs.promotional_enabled })} />

      <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.06)' }} />

      <Row label={t('notifQuietHours')} value={prefs.quiet_hours_enabled} onToggle={() => set({ quiet_hours_enabled: !prefs.quiet_hours_enabled })} />
      {prefs.quiet_hours_enabled && (
        <div className="flex items-center gap-3 pl-1 pt-1">
          <label className="flex items-center gap-1.5 text-[#3A6045] text-[11px]">
            {t('notifQuietFrom')}
            <input
              type="time"
              value={minToTime(prefs.quiet_start_min)}
              onChange={(e) => set({ quiet_start_min: timeToMin(e.target.value) })}
              className="bg-transparent text-white text-xs rounded px-1 py-0.5"
              style={{ border: '1px solid rgba(0,255,127,0.15)' }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[#3A6045] text-[11px]">
            {t('notifQuietTo')}
            <input
              type="time"
              value={minToTime(prefs.quiet_end_min)}
              onChange={(e) => set({ quiet_end_min: timeToMin(e.target.value) })}
              className="bg-transparent text-white text-xs rounded px-1 py-0.5"
              style={{ border: '1px solid rgba(0,255,127,0.15)' }}
            />
          </label>
        </div>
      )}
    </div>
  );
};

export default NotificationSettings;
