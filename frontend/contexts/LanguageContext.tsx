import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { translations, type Lang, type TranslationKey } from '@/lib/i18n';

const STORAGE_KEY = 'wallet_language';

interface TelegramWebApp {
  initDataUnsafe?: { user?: { language_code?: string } };
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'ru';

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'ru' || stored === 'en') return stored;

  const tg = (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  const tgLang = tg?.initDataUnsafe?.user?.language_code;
  if (tgLang) return tgLang === 'ru' ? 'ru' : 'en';

  const browserLang = navigator.language || '';
  return browserLang.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>('ru');

  useEffect(() => {
    setLangState(detectLang());
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
    }
  };

  const t = useMemo(() => {
    return (key: TranslationKey): string => translations[lang][key] ?? translations.ru[key] ?? key;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
