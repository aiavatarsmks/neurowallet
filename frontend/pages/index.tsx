import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const WELCOME_SEEN_KEY = 'nw_welcome_seen_v1';

function getSlides(t: (key: import('@/lib/i18n').TranslationKey) => string) {
  return [
    {
      title: t('slide1Title'),
      subtitle: t('slide1Subtitle'),
      icon: (
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="30" stroke="#00FF7F" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.4"/>
          <circle cx="32" cy="32" r="20" stroke="#00FF7F" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="32" cy="32" r="8" fill="rgba(0,255,127,0.15)" stroke="#00FF7F" strokeWidth="1.5"/>
          <circle cx="32" cy="32" r="3" fill="#00FF7F"/>
          <line x1="32" y1="4" x2="32" y2="16" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="60" y1="32" x2="48" y2="32" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="32" y1="60" x2="32" y2="48" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="4" y1="32" x2="16" y2="32" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      title: t('slide2Title'),
      subtitle: t('slide2Subtitle'),
      icon: (
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <path d="M32 6L8 18v16c0 14 11 27 24 30 13-3 24-16 24-30V18L32 6z" stroke="#00FF7F" strokeWidth="1.5" fill="rgba(0,255,127,0.06)"/>
          <path d="M22 32l6 6 14-12" stroke="#00FF7F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="32" cy="22" r="2" fill="#00FF7F"/>
        </svg>
      ),
    },
    {
      title: t('slide3Title'),
      subtitle: t('slide3Subtitle'),
      icon: (
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect x="12" y="10" width="40" height="44" rx="6" stroke="#00FF7F" strokeWidth="1.5" fill="rgba(0,255,127,0.04)"/>
          <line x1="22" y1="22" x2="42" y2="22" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
          <line x1="22" y1="30" x2="42" y2="30" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
          <line x1="22" y1="38" x2="34" y2="38" stroke="#00FF7F" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
          <circle cx="46" cy="46" r="10" fill="#080C09" stroke="#00FF7F" strokeWidth="1.5"/>
          <polyline points="41 46 44 49 51 43" stroke="#00FF7F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
  ];
}

export default function OnboardingPage() {
  const [slide, setSlide] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [hasExistingWallet, setHasExistingWallet] = useState(false);
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  const router = useRouter();
  const { enterDemo, isDemo, isLoading, user } = useAuth();
  const { t } = useLanguage();
  const SLIDES = getSlides(t);

  useEffect(() => {
    if (isLoading || typeof window === 'undefined') return;
    const seen = localStorage.getItem(WELCOME_SEEN_KEY) === '1';
    const hasWallet = !!localStorage.getItem('wallet_eth_address');
    setWelcomeSeen(seen);
    setHasExistingWallet(hasWallet);
    if (!seen) return;

    if (isDemo) {
      router.replace('/wallet');
    } else if (hasWallet) {
      // Returning users choose explicitly: unlock real wallet or enter demo.
      // PIN is requested only after pressing "Войти".
    } else if (user) {
      router.replace('/onboarding');
    } else {
      router.replace('/auth');
    }
  }, [isDemo, isLoading, router, user]);

  const markWelcomeSeen = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(WELCOME_SEEN_KEY, '1');
    }
  };

  const goToAuth = () => {
    markWelcomeSeen();
    router.push('/auth');
  };

  const goToDemo = () => {
    enterDemo();
    router.push('/wallet');
  };

  const goToWalletUnlock = () => {
    router.push('/wallet');
  };

  const handleSwipeEnd = (x: number) => {
    if (touchStartX === null) return;
    const delta = x - touchStartX;
    setTouchStartX(null);
    if (Math.abs(delta) < 44) return;
    if (delta < 0 && slide < SLIDES.length - 1) setSlide(slide + 1);
    if (delta > 0 && slide > 0) setSlide(slide - 1);
  };

  // "Пропустить" тоже ведёт на auth, а не в wallet
  const goToApp = goToAuth;

  if (!isLoading && welcomeSeen && hasExistingWallet && !isDemo) {
    return (
      <main
        className="min-h-screen flex flex-col max-w-[430px] mx-auto px-6"
        style={{ backgroundColor: '#080C09' }}
      >
        <div className="flex justify-between items-center pt-14 pb-2">
          <LanguageSwitcher />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center gap-7">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{
              background: 'radial-gradient(ellipse at 40% 30%, rgba(0,255,127,0.2) 0%, rgba(0,255,127,0.04) 100%)',
              border: '1.5px solid rgba(0,255,127,0.3)',
              boxShadow: '0 0 32px rgba(0,255,127,0.12)',
            }}
          >
            <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
              <polyline points="6,22 6,6 22,22 22,6" stroke="#00FF7F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold text-white leading-tight">
              {t('returnTitle')}
            </h1>
            <p className="text-[#3A6045] text-base leading-relaxed max-w-[310px] mx-auto">
              {t('returnSubtitle')}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 pb-14">
          <button
            onClick={goToWalletUnlock}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
          >
            {t('returnUnlock')}
          </button>

          <button
            onClick={goToDemo}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{
              background: 'transparent',
              border: '1.5px solid rgba(0,255,127,0.3)',
              color: '#00FF7F',
            }}
          >
            {t('landingDemoMode')}
          </button>

          <p className="text-center text-[#3A6045] text-xs mt-1">
            {t('returnPinHint')}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen flex flex-col max-w-[430px] mx-auto px-6"
      style={{ backgroundColor: '#080C09' }}
    >
      {/* Skip */}
      <div className="flex justify-between items-center pt-14 pb-2">
        <LanguageSwitcher />
        <button
          onClick={goToApp}
          className="text-[#3A6045] text-sm font-medium"
        >
          {t('landingSkip')}
        </button>
      </div>

      {/* Slide content */}
      <div
        className="flex-1 flex flex-col items-center justify-center text-center gap-8"
        onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => handleSwipeEnd(event.changedTouches[0]?.clientX ?? 0)}
      >
        {/* Icon */}
        <div
          className="w-32 h-32 rounded-full flex items-center justify-center"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,255,127,0.1) 0%, rgba(0,255,127,0.03) 60%, transparent 100%)',
            border: '1px solid rgba(0,255,127,0.15)',
          }}
        >
          {SLIDES[slide].icon}
        </div>

        {/* Text */}
        <div className="flex flex-col gap-4">
          <h1
            className="text-3xl font-bold text-white leading-tight"
            style={{ whiteSpace: 'pre-line' }}
          >
            {SLIDES[slide].title}
          </h1>
          <p className="text-[#3A6045] text-base leading-relaxed max-w-[300px] mx-auto">
            {SLIDES[slide].subtitle}
          </p>
        </div>

        {/* Dots */}
        <div className="flex gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className="transition-all"
              style={{
                width: i === slide ? '24px' : '8px',
                height: '8px',
                borderRadius: '4px',
                background: i === slide ? '#00FF7F' : 'rgba(0,255,127,0.2)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 pb-14">
        {slide < SLIDES.length - 1 ? (
          <button
            onClick={() => setSlide(slide + 1)}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
          >
            {t('landingNext')}
          </button>
        ) : (
          <button
            onClick={goToAuth}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
          >
            {t('landingStart')}
          </button>
        )}

        <button
          onClick={goToDemo}
          className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
          style={{
            background: 'transparent',
            border: '1.5px solid rgba(0,255,127,0.3)',
            color: '#00FF7F',
          }}
        >
          {t('landingDemoMode')}
        </button>

        <p className="text-center text-[#3A6045] text-xs mt-1">
          {t('landingDemoHint')}
        </p>

        <p className="text-center text-[#3A6045] text-xs mt-3">
          <Link href="/privacy" style={{ color: '#3A6045', textDecoration: 'underline' }}>
            {t('landingPrivacyLink')}
          </Link>
        </p>
      </div>
    </main>
  );
}
