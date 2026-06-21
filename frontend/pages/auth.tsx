import { useState, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';

type Mode = 'signin' | 'signup';

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {open ? (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </>
    ) : (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </>
    )}
  </svg>
);

export default function AuthPage() {
  const router = useRouter();
  const { signIn, signUp, enterDemo } = useAuth();

  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Заполните все поля');
      return;
    }
    if (password.length < 6) {
      setError('Пароль — минимум 6 символов');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUp(email, password, name);
        router.push('/onboarding');
      } else {
        await signIn(email, password);
        const hasWallet = typeof window !== 'undefined' && !!localStorage.getItem('wallet_eth_address');
        router.push(hasWallet ? '/wallet' : '/onboarding');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Что-то пошло не так';
      setError(msg === 'CONFIRM_EMAIL' ? 'Проверь почту — мы отправили ссылку для подтверждения' : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = () => {
    enterDemo();
    router.push('/wallet');
  };

  return (
    <main
      className="min-h-screen flex flex-col max-w-[430px] mx-auto px-6"
      style={{ backgroundColor: '#080C09' }}
    >
      {/* Logo */}
      <div className="flex flex-col items-center pt-16 pb-8 gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: 'radial-gradient(ellipse at 40% 30%, rgba(0,255,127,0.2) 0%, rgba(0,255,127,0.04) 100%)',
            border: '1.5px solid rgba(0,255,127,0.3)',
            boxShadow: '0 0 32px rgba(0,255,127,0.12)',
          }}
        >
          {/* Minimalist N icon */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <polyline points="6,22 6,6 22,22 22,6" stroke="#00FF7F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="text-white text-xl font-bold tracking-tight">NeuroWallet</p>
          <p className="text-[#3A6045] text-sm mt-0.5">Финансовый автопилот</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div
        className="flex rounded-2xl p-1 mb-6"
        style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.1)' }}
      >
        {(['signup', 'signin'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(''); }}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={
              mode === m
                ? { background: 'rgba(0,255,127,0.12)', color: '#00FF7F', border: '1px solid rgba(0,255,127,0.2)' }
                : { color: '#3A6045', border: '1px solid transparent' }
            }
          >
            {m === 'signup' ? 'Регистрация' : 'Войти'}
          </button>
        ))}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === 'signup' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">Имя</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как тебя зовут?"
              autoComplete="name"
              className="w-full px-4 py-3.5 rounded-xl text-white text-sm outline-none transition-all placeholder:text-[#3A6045]"
              style={{
                background: '#0D1A10',
                border: '1px solid rgba(0,255,127,0.15)',
                caretColor: '#00FF7F',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(0,255,127,0.4)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(0,255,127,0.15)')}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            className="w-full px-4 py-3.5 rounded-xl text-white text-sm outline-none transition-all placeholder:text-[#3A6045]"
            style={{
              background: '#0D1A10',
              border: '1px solid rgba(0,255,127,0.15)',
              caretColor: '#00FF7F',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'rgba(0,255,127,0.4)')}
            onBlur={(e) => (e.target.style.borderColor = 'rgba(0,255,127,0.15)')}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">Пароль</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 6 символов"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              className="w-full px-4 py-3.5 pr-12 rounded-xl text-white text-sm outline-none transition-all placeholder:text-[#3A6045]"
              style={{
                background: '#0D1A10',
                border: '1px solid rgba(0,255,127,0.15)',
                caretColor: '#00FF7F',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(0,255,127,0.4)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(0,255,127,0.15)')}
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#3A6045] transition-colors hover:text-[#00FF7F]"
            >
              <EyeIcon open={showPass} />
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="px-4 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)', color: '#FF6B6B' }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 mt-2 disabled:opacity-50"
          style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
        >
          {loading ? '...' : mode === 'signup' ? 'Создать аккаунт' : 'Войти в аккаунт'}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-4 my-5">
        <div className="flex-1 h-px" style={{ background: 'rgba(0,255,127,0.1)' }} />
        <span className="text-[#3A6045] text-xs">или</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(0,255,127,0.1)' }} />
      </div>

      {/* Demo mode */}
      <button
        onClick={handleDemo}
        className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
        style={{
          background: 'transparent',
          border: '1.5px solid rgba(0,255,127,0.25)',
          color: '#00FF7F',
        }}
      >
        ✦ Режим демо
      </button>

      <p className="text-center text-[#3A6045] text-xs mt-3 pb-10">
        В демо-режиме используются только тестовые данные. Реальный кошелёк не требуется.
      </p>
    </main>
  );
}
