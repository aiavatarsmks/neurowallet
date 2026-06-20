import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  isDemo: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterDemo: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_KEY = 'nw_demo';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    isDemo: false,
    isLoading: true,
  });

  useEffect(() => {
    // Check demo mode
    if (localStorage.getItem(DEMO_KEY) === 'true') {
      setState({ user: null, session: null, isDemo: true, isLoading: false });
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        user: session?.user ?? null,
        session,
        isDemo: false,
        isLoading: false,
      });
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({
        ...prev,
        user: session?.user ?? null,
        session,
        isLoading: false,
      }));
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(translateError(error.message));
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateError(error.message));
  };

  const signOut = async () => {
    localStorage.removeItem(DEMO_KEY);
    await supabase.auth.signOut();
    setState({ user: null, session: null, isDemo: false, isLoading: false });
  };

  const enterDemo = () => {
    localStorage.setItem(DEMO_KEY, 'true');
    setState({ user: null, session: null, isDemo: true, isLoading: false });
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

// Translate Supabase errors to Russian
function translateError(msg: string): string {
  if (msg.includes('User already registered'))  return 'Аккаунт с таким email уже существует';
  if (msg.includes('Invalid login credentials')) return 'Неверный email или пароль';
  if (msg.includes('Email not confirmed'))       return 'Подтверди email — письмо отправлено';
  if (msg.includes('Password should be'))        return 'Пароль должен быть минимум 6 символов';
  if (msg.includes('Unable to validate'))        return 'Проверь подключение к интернету';
  return msg;
}
