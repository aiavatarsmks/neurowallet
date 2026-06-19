import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface User {
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

const SESSION_KEY = 'nw_session';
const DEMO_KEY = 'nw_demo';
const USERS_KEY = 'nw_users'; // { [email]: { passwordHash, name, createdAt } }

// Simple hash — not cryptographic, just obfuscation for localStorage demo
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isDemo: false,
    isLoading: true,
  });

  // Restore session on mount
  useEffect(() => {
    try {
      const demo = localStorage.getItem(DEMO_KEY);
      if (demo === 'true') {
        setState({ user: null, isDemo: true, isLoading: false });
        return;
      }
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const user: User = JSON.parse(raw);
        setState({ user, isDemo: false, isLoading: false });
        return;
      }
    } catch {
      // ignore
    }
    setState((s) => ({ ...s, isLoading: false }));
  }, []);

  const signUp = async (email: string, password: string, name?: string) => {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
    const key = email.toLowerCase().trim();
    if (users[key]) throw new Error('Аккаунт с таким email уже существует');

    const user: User = {
      email: key,
      name: name?.trim() || key.split('@')[0],
      createdAt: new Date().toISOString(),
    };
    users[key] = { passwordHash: simpleHash(password), name: user.name, createdAt: user.createdAt };
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    localStorage.removeItem(DEMO_KEY);
    setState({ user, isDemo: false, isLoading: false });
  };

  const signIn = async (email: string, password: string) => {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
    const key = email.toLowerCase().trim();
    const record = users[key];
    if (!record) throw new Error('Аккаунт не найден. Сначала зарегистрируйтесь.');
    if (record.passwordHash !== simpleHash(password)) throw new Error('Неверный пароль');

    const user: User = { email: key, name: record.name, createdAt: record.createdAt };
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    localStorage.removeItem(DEMO_KEY);
    setState({ user, isDemo: false, isLoading: false });
  };

  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(DEMO_KEY);
    setState({ user: null, isDemo: false, isLoading: false });
  };

  const enterDemo = () => {
    localStorage.setItem(DEMO_KEY, 'true');
    localStorage.removeItem(SESSION_KEY);
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
