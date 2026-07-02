import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

interface LanguageSwitcherProps {
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className }) => {
  const { lang, setLang, t } = useLanguage();

  return (
    <div
      className={`inline-flex rounded-full p-0.5 ${className ?? ''}`}
      style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)' }}
    >
      {(['ru', 'en'] as const).map((code) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            className="px-3 py-1 rounded-full text-xs font-semibold transition-all active:scale-95"
            style={{
              background: active ? 'rgba(0,255,127,0.15)' : 'transparent',
              color: active ? '#00FF7F' : '#3A6045',
            }}
          >
            {code === 'ru' ? t('languageRu') : t('languageEn')}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
