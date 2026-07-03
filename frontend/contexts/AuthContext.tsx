import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { track } from '@/lib/analytics';

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
    // Telegram initData takes priority over everything — always try real auth first
    const initData = getTelegramInitData();
    if (initData) {
      // Clear stale demo flag so a real TG user never gets stuck in demo mode
      if (typeof window !== 'undefined') localStorage.removeItem(DEMO_KEY);
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
            // Don't override if user chose demo mode while TG auth was in flight
            setState(prev => prev.isDemo ? prev : { user: data.user, isDemo: false, isLoading: false });
          } else {
            setState(prev => prev.isDemo ? prev : { user: null, isDemo: false, isLoading: false });
          }
        })
        .catch(() => setState(prev => prev.isDemo ? prev : { user: null, isDemo: false, isLoading: false }));
      return;
    }

    // No Telegram context — check for saved demo session
    if (typeof window !== 'undefined' && localStorage.getItem(DEMO_KEY) === 'true') {
      setState({ user: null, isDemo: true, isLoading: false });
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user ? toUser(data.session.user) : null;
      // Use functional update so we never override an isDemo=true set by enterDemo()
      setState(prev => prev.isDemo ? prev : { user, isDemo: false, isLoading: false });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ? toUser(session.user) : null;
      // Same: preserve isDemo if user explicitly entered demo mode
      setState(s => s.isDemo ? s : { ...s, user, isLoading: false });
      // Склейка анонимных pre-auth событий с пользователем (раз на вкладку).
      if (event === 'SIGNED_IN' && session?.user && !sessionStorage.getItem('nw_identified')) {
        sessionStorage.setItem('nw_identified', '1');
        track('session_identified');
        // Регистрация устройства для security center (1.6), fire-and-forget.
        void fetch('/api/device-ping', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => {});
      }
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
    if (error) {
      // If email exists but wasn't confirmed (created before mailer_autoconfirm was enabled),
      // try signUp — with mailer_autoconfirm:true it returns a session immediately.
      if (error.message.includes('Email not confirmed')) {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: email.split('@')[0] } },
        });
        if (!signUpError && signUpData.session && signUpData.user) {
          setState(s => ({ ...s, user: toUser(signUpData.user!), isLoading: false }));
          return;
        }
      }
      throw new Error(translateError(error.message));
    }
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
    supabase.auth.signOut();
    setState({ user: null, isDemo: true, isLoading: false });
    track('demo_entered');
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
