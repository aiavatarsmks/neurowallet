import React, { useState, useEffect, useCallback } from 'react';
import { setupPin } from '@/lib/pin';

interface PinSetupProps {
  walletPassword: string;
  onComplete: () => void;
  onSkip: () => void;
}

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export const PinSetup: React.FC<PinSetupProps> = ({ walletPassword, onComplete, onSkip }) => {
  const [step,    setStep]    = useState<'enter' | 'confirm'>('enter');
  const [pin,     setPin]     = useState('');
  const [first,   setFirst]   = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleDigit = useCallback((d: string) => {
    if (loading) return;
    if (d === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (d === '') return;
    if (pin.length >= 4) return;
    setPin(p => p + d);
  }, [pin, loading]);

  // Auto-advance when 4 digits entered
  useEffect(() => {
    if (pin.length !== 4) return;

    if (step === 'enter') {
      setFirst(pin);
      setPin('');
      setStep('confirm');
      return;
    }

    // Confirm step
    if (pin !== first) {
      setPin('');
      setError('PIN-коды не совпадают. Попробуйте снова.');
      setStep('enter');
      setFirst('');
      return;
    }

    // Match — save PIN
    setLoading(true);
    setupPin(walletPassword, pin)
      .then(() => onComplete())
      .catch(() => {
        setLoading(false);
        setError('Ошибка сохранения. Попробуйте снова.');
        setPin('');
        setStep('enter');
        setFirst('');
      });
  }, [pin, step, first, walletPassword, onComplete]);

  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center max-w-[430px] mx-auto px-8"
      style={{ backgroundColor: '#080C09' }}
    >
      {/* Icon */}
      <div className="mb-10 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.25)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00FF7F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <p className="text-white text-lg font-semibold">
          {step === 'enter' ? 'Придумайте PIN-код' : 'Повторите PIN-код'}
        </p>
        <p className="text-[#3A6045] text-sm mt-1 leading-snug">
          {step === 'enter'
            ? 'Будет использоваться для быстрого входа'
            : 'Введите PIN ещё раз для подтверждения'}
        </p>
      </div>

      {/* Progress dots */}
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

      {/* Error */}
      {error ? (
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
            disabled={loading || d === ''}
            className="h-16 rounded-2xl flex items-center justify-center text-2xl font-semibold transition-all active:scale-90"
            style={{
              background: d === '' ? 'transparent' : 'rgba(0,255,127,0.06)',
              border: d === '' ? 'none' : '1px solid rgba(0,255,127,0.12)',
              color: d === '⌫' ? '#3A6045' : '#fff',
              opacity: d === '' || loading ? 0.3 : 1,
            }}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Skip */}
      <button
        onClick={onSkip}
        className="mt-8 text-[#3A6045] text-sm"
        disabled={loading}
      >
        Пропустить →
      </button>
      <p className="text-[#3A6045] text-xs mt-2 text-center opacity-60">
        Можно настроить позже в настройках
      </p>
    </div>
  );
};

export default PinSetup;
