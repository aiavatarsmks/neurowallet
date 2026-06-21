import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  enterDemo: () => void;
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
  const [state, setState] = useState<AuthState>({
    user: null,
    isDemo: false,
    isLoading: true,
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(DEMO_KEY) === 'true') {
      setState({ user: null, isDemo: true, isLoading: false });
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

  const signOut = () => {
    if (typeof window !== 'undefined') localStorage.removeItem(DEMO_KEY);
    supabase.auth.signOut();
    setState({ user: null, isDemo: false, isLoading: false });
  };

  const enterDemo = () => {
    if (typeof window !== 'undefined') localStorage.setItem(DEMO_KEY, 'true');
    setState({ user: null, isDemo: true, isLoading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, signOut, enterDemo }}>
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
