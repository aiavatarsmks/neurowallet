import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// ─── Telegram helper (safe to call on web) ────────────────────────────────────
function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  return (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? '';
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  isDemo: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  signUp:              (email: string, password: string, name?: string) => Promise<void>;
  signIn:              (email: string, password: string) => Promise<void>;
  signInWithTelegram:  (initData: string) => Promise<void>;
  signOut:             () => void;
  enterDemo:           () => void;
  isTelegramUser:      boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_KEY = 'nw_demo';

function toUser(su: SupabaseUser): User {
  return {
    id: su.id,
    email: su.email ?? '',
    name: (su.user_metadata?.name as string) || (su.email ?? '').split('@')[0],
    createdAt: su.created_at,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState]            = useState<AuthState>({ user: null, isDemo: false, isLoading: true });
  const [isTelegramUser, setIsTgUser] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(DEMO_KEY) === 'true') {
      setState({ user: null, isDemo: true, isLoading: false });
      return;
    }

    // Auto-login via Telegram initData if running inside Telegram Mini App
    const initData = getTelegramInitData();
    if (initData) {
      setIsTgUser(true);
      fetch('/api/tg-auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(async (data) => {
          if (data?.access_token) {
            await supabase.auth.setSession({
              access_token:  data.access_token,
              refresh_token: data.refresh_token,
            });
            if (data.user?.telegram_id) {
              localStorage.setItem('tg_user_id', String(data.user.telegram_id));
            }
            // Store TG username/name from SDK (available immediately)
            const tgSdk = (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { username?: string; first_name?: string; last_name?: string; photo_url?: string } } } } }).Telegram?.WebApp?.initDataUnsafe?.user;
            if (tgSdk?.username)   localStorage.setItem('tg_username',   tgSdk.username);
            if (tgSdk?.first_name) localStorage.setItem('tg_first_name', tgSdk.first_name);
            if (tgSdk?.last_name)  localStorage.setItem('tg_last_name',  tgSdk.last_name);
            if (tgSdk?.photo_url)  localStorage.setItem('tg_photo_url',  tgSdk.photo_url);
            setState({ user: data.user, isDemo: false, isLoading: false });
          } else {
            setState({ user: null, isDemo: false, isLoading: false });
          }
        })
        .catch(() => setState({ user: null, isDemo: false, isLoading: false }));
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user ? toUser(data.session.user) : null;
      setState({ user, isDemo: false, isLoading: false });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ? toUser(session.user) : null;
      setState(s => ({ ...s, user, isLoading: false }));
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, name?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name?.trim() || email.split('@')[0] } },
    });
    if (error) throw new Error(translateError(error.message));
    if (!data.session) {
      throw new Error('CONFIRM_EMAIL');
    }
    const user = data.user ? toUser(data.user) : null;
    setState(s => ({ ...s, user, isLoading: false }));
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateError(error.message));
  };

  const signInWithTelegram = async (initData: string) => {
    const res  = await fetch('/api/tg-auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ initData }),
    });
    if (!res.ok) throw new Error('Telegram auth failed');
    const data = await res.json();
    await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
    setIsTgUser(true);
    setState({ user: data.user, isDemo: false, isLoading: false });
  };

  const signOut = () => {
    if (typeof window !== 'undefined') localStorage.removeItem(DEMO_KEY);
    supabase.auth.signOut();
    setIsTgUser(false);
    setState({ user: null, isDemo: false, isLoading: false });
  };

  const enterDemo = () => {
    if (typeof window !== 'undefined') localStorage.setItem(DEMO_KEY, 'true');
    setState({ user: null, isDemo: true, isLoading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, signInWithTelegram, signOut, enterDemo, isTelegramUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function translateError(msg: string): string {
  if (msg.includes('User already registered'))  return 'Аккаунт с таким email уже существует';
  if (msg.includes('Invalid login credentials')) return 'Неверный email или пароль';
  if (msg.includes('Email not confirmed'))       return 'Подтверди email — письмо отправлено';
  if (msg.includes('Password should be'))        return 'Пароль должен быть минимум 6 символов';
  if (msg.includes('Unable to validate'))        return 'Проверь подключение к интернету';
  return msg;
}
