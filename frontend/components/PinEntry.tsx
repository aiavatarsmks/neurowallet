import React, { useState, useEffect, useCallback, useRef } from 'react';
import { verifyPin, getLockoutMs, getRemainingAttempts } from '@/lib/pin';
import { useLanguage } from '@/contexts/LanguageContext';

interface PinEntryProps {
  /** Called once the PIN is verified. The PIN unlocks the UI only; it never yields the wallet password. */
  onSuccess: () => void;
  /** Optional: switch to demo mode from the lock screen (DEMO_PIN_FIX.md, Fix 1). */
  onDemo?: () => void;
  /** Optional: start the "Forgot PIN?" flow (wallet password → new PIN). */
  onForgotPin?: () => void;
}

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export const PinEntry: React.FC<PinEntryProps> = ({ onSuccess, onDemo, onForgotPin }) => {
  const { t } = useLanguage();
  const [pin,       setPin]       = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [lockSecs,  setLockSecs]  = useState(0);
  const [remaining, setRemaining] = useState(getRemainingAttempts());

  // Parents pass inline callbacks. Keep the latest ones in refs so a parent
  // re-render during the ~1 s PBKDF2 check does not re-run the verify effect
  // (which would count one wrong PIN twice).
  const onSuccessRef = useRef(onSuccess);
  const tRef = useRef(t);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { tRef.current = t; }, [t]);

  // Lockout countdown
  useEffect(() => {
    const ms = getLockoutMs();
    if (ms <= 0) return;
    setLockSecs(Math.ceil(ms / 1000));
    const id = setInterval(() => {
      const left = Math.ceil(getLockoutMs() / 1000);
      setLockSecs(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleDigit = useCallback((d: string) => {
    if (lockSecs > 0 || loading) return;
    if (d === '⌫') {
      setPin(p => p.slice(0, -1));
      setError('');
      return;
    }
    if (d === '') return;
    if (pin.length >= 4) return;
    setPin(p => p + d);
  }, [pin, lockSecs, loading]);

  // Auto-verify when 4 digits entered
  useEffect(() => {
    if (pin.length !== 4) return;
    let cancelled = false;
    setLoading(true);
    verifyPin(pin)
      .then(() => { if (!cancelled) onSuccessRef.current(); })
      .catch((e: Error) => {
        if (cancelled) return;
        setPin('');
        setLoading(false);
        const msg = e.message;
        const tr = tRef.current;
        if (msg.startsWith('LOCKED:')) {
          const mins = msg.split(':')[1];
          setLockSecs(parseInt(mins, 10) * 60);
          setError(tr('pinLockedMsg').replace('{mins}', mins));
        } else if (msg.startsWith('WRONG:')) {
          const left = parseInt(msg.split(':')[1], 10);
          setRemaining(left);
          setError(tr('pinWrongMsg').replace('{n}', String(left)));
        } else {
          setError(msg);
        }
      });
    return () => { cancelled = true; };
  }, [pin]);

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length);

  return (
    <div
      data-testid="pin-entry"
      className="min-h-screen flex flex-col items-center justify-center max-w-[430px] mx-auto px-8 py-10"
      style={{ backgroundColor: '#080C09' }}
    >
      {/* Logo */}
      <div className="mb-10 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.25)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00FF7F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <p className="text-white text-lg font-semibold">{t('pinEnterTitle')}</p>
        <p className="text-[#3A6045] text-sm mt-1">{t('pinForAccess')}</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-4 mb-8">
        {dots.map((filled, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full transition-all duration-150"
            style={{
              background: filled ? '#00FF7F' : 'transparent',
              border: `2px solid ${filled ? '#00FF7F' : 'rgba(0,255,127,0.3)'}`,
              boxShadow: filled ? '0 0 8px rgba(0,255,127,0.5)' : 'none',
            }}
          />
        ))}
      </div>

      {/* Error / lockout message */}
      {lockSecs > 0 ? (
        <p className="text-red-400 text-sm mb-6 text-center">
          {t('pinLockedCountdown').replace('{mins}', String(Math.ceil(lockSecs / 60))).replace('{secs}', String(lockSecs % 60))}
        </p>
      ) : error ? (
        <p className="text-red-400 text-sm mb-6 text-center">{error}</p>
      ) : (
        <div className="h-6 mb-6" />
      )}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
        {DIGITS.map((d, i) => (
          <button
            key={i}
            onClick={() => handleDigit(d)}
            disabled={lockSecs > 0 || loading || d === ''}
            className="h-16 rounded-2xl flex items-center justify-center text-2xl font-semibold transition-all active:scale-90"
            style={{
              background: d === '' ? 'transparent' : 'rgba(0,255,127,0.06)',
              border: d === '' ? 'none' : '1px solid rgba(0,255,127,0.12)',
              color: d === '⌫' ? '#3A6045' : '#fff',
              opacity: d === '' || (lockSecs > 0) ? 0.3 : 1,
            }}
          >
            {loading && pin.length === 4 && d !== '⌫' ? '' : d}
          </button>
        ))}
      </div>

      {remaining < 5 && remaining > 0 && !error && (
        <p className="text-[#3A6045] text-xs mt-6">{t('pinAttemptsLeft').replace('{n}', String(remaining))}</p>
      )}

      {/* Forgot PIN: reset with the wallet password (works during lockout too). */}
      {onForgotPin && (
        <button
          type="button"
          onClick={onForgotPin}
          disabled={loading}
          className="mt-6 text-xs underline disabled:opacity-40"
          style={{ color: '#7FBF9A' }}
        >
          {t('pinForgot')}
        </button>
      )}

      {/* Demo entry (DEMO_PIN_FIX.md, Fix 1): the TG auto-login lands real users
          here, and /auth with its demo button is never reached. */}
      {onDemo && (
        <div className="w-full max-w-[280px] mt-8 flex flex-col items-center gap-3">
          <div className="w-full flex items-center gap-3" aria-hidden="true">
            <div className="flex-1 h-px" style={{ background: 'rgba(0,255,127,0.12)' }} />
            <span className="text-[#3A6045] text-xs">{t('pinOr')}</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(0,255,127,0.12)' }} />
          </div>
          <button
            type="button"
            onClick={onDemo}
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'transparent', border: '1px solid rgba(0,255,127,0.2)', color: '#3A6045' }}
          >
            {t('pinDemoCta')}
          </button>
        </div>
      )}
    </div>
  );
};

export default PinEntry;
