/**
 * components/NotificationsInbox.tsx — in-app inbox (Фаза 2.4 v1).
 * Reads the user's notifications under RLS (SELECT own). Renders nothing in
 * demo, signed-out, on error, or when empty — so it can never break the
 * profile page even before the migration is applied.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

interface Notif {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export const NotificationsInbox: React.FC = () => {
  const { isDemo, user } = useAuth();
  const { t } = useLanguage();
  const [items, setItems] = useState<Notif[]>([]);

  const load = async () => {
    try {
      const { data } = await supabase
        .from('notifications')
        .select('id, kind, title, body, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (Array.isArray(data)) setItems(data as Notif[]);
    } catch {
      /* table may not exist yet / offline — render nothing */
    }
  };

  useEffect(() => {
    if (!isDemo && user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, user]);

  if (isDemo || !user || items.length === 0) return null;

  const unread = items.filter((i) => !i.read_at).length;

  const markAll = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ all: true }),
      });
      setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}>
      <div className="flex items-center justify-between">
        <p className="text-white text-sm font-semibold">
          {t('inboxTitle')}
          {unread > 0 && (
            <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,255,127,0.12)', color: '#00FF7F' }}>
              {unread}
            </span>
          )}
        </p>
        {unread > 0 && (
          <button onClick={markAll} className="text-[10px] font-semibold" style={{ color: '#3A6045' }}>
            {t('inboxMarkAllRead')}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
        {items.map((n) => (
          <div key={n.id} className="flex flex-col gap-0.5 rounded-xl px-3 py-2" style={{ background: n.read_at ? 'transparent' : 'rgba(0,255,127,0.05)' }}>
            <div className="flex items-center justify-between">
              <span className="text-white text-xs font-medium">{n.title}</span>
              <span className="text-[#3A6045] text-[10px]">{new Date(n.created_at).toLocaleDateString()}</span>
            </div>
            {n.body && <span className="text-[#3A6045] text-xs leading-snug">{n.body}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationsInbox;
