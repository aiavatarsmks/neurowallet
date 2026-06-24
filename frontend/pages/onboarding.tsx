import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { generateMnemonic, importWalletFromMnemonic } from '@/lib/crypto/wallet';

type Step = 'choice' | 'show-mnemonic' | 'verify-mnemonic' | 'import-mnemonic' | 'set-password' | 'generating';

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

export default function OnboardingWalletPage() {
  const router = useRouter();
  const { user, isDemo, isLoading } = useAuth();

  const [step, setStep] = useState<Step>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonicInput, setImportMnemonicInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const [error, setError] = useState('');

  // Verification step state
  const [verifyIndices, setVerifyIndices]   = useState<number[]>([]);
  const [verifyInputs,  setVerifyInputs]    = useState<string[]>(['', '', '']);

  // Guard: redirect if already has wallet or not authenticated
  useEffect(() => {
    if (isLoading) return;
    if (!user && !isDemo) {
      router.replace('/auth');
      return;
    }
    if (typeof window !== 'undefined' && localStorage.getItem('wallet_eth_address')) {
      router.replace('/wallet');
    }
  }, [isLoading, user, isDemo, router]);

  const handleCreateNew = useCallback(() => {
    const m = generateMnemonic();
    setMnemonic(m);
    setStep('show-mnemonic');
    setCanContinue(false);
    setTimeout(() => setCanContinue(true), 3000);
  }, []);

  const handleImport = () => {
    setStep('import-mnemonic');
    setError('');
  };

  const handleImportContinue = () => {
    const words = importMnemonicInput.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12) {
      setError('Нужно ровно 12 слов');
      return;
    }
    setMnemonic(importMnemonicInput.trim().toLowerCase());
    setStep('set-password');
    setError('');
  };

  const handleMnemonicConfirm = () => {
    // Pick 3 random distinct word indices for verification
    const indices: number[] = [];
    while (indices.length < 3) {
      const r = Math.floor(Math.random() * 12);
      if (!indices.includes(r)) indices.push(r);
    }
    indices.sort((a, b) => a - b);
    setVerifyIndices(indices);
    setVerifyInputs(['', '', '']);
    setError('');
    setStep('verify-mnemonic');
  };

  const handleVerify = () => {
    const words = mnemonic.split(' ');
    for (let i = 0; i < 3; i++) {
      const expected = words[verifyIndices[i]].trim().toLowerCase();
      const entered  = verifyInputs[i].trim().toLowerCase();
      if (expected !== entered) {
        setError(`Слово #${verifyIndices[i] + 1} введено неверно. Проверь запись и попробуй снова.`);
        return;
      }
    }
    setError('');
    setStep('set-password');
  };

  const handleGenerate = async () => {
    if (!password) { setError('Введи пароль'); return; }
    if (password.length < 6) { setError('Пароль — минимум 6 символов'); return; }
    if (password !== confirmPassword) { setError('Пароли не совпадают'); return; }

    setStep('generating');
    setError('');

    try {
      const wallet = await importWalletFromMnemonic(mnemonic, password);
      if (typeof window !== 'undefined') {
        localStorage.setItem('wallet_eth_address',  wallet.eth);
        localStorage.setItem('wallet_sol_address',  wallet.sol);
        localStorage.setItem('wallet_btc_address',  wallet.btc);
        localStorage.setItem('wallet_tron_address', wallet.tron);
        localStorage.setItem('wallet_keystore',     wallet.keystore);
        localStorage.setItem('wallet_sol_xor',      wallet.solXor);
        localStorage.setItem('wallet_btc_xor',      wallet.btcXor);
        localStorage.setItem('wallet_tron_xor',     wallet.tronXor);
      }
      router.push('/wallet');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка генерации');
      setStep('set-password');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#080C09' }}>
        <div className="w-2 h-2 rounded-full bg-[#00FF7F]" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
        <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      </div>
    );
  }

  const words = mnemonic.split(' ');

  return (
    <main className="min-h-screen flex flex-col max-w-[430px] mx-auto px-6" style={{ backgroundColor: '#080C09' }}>

      {/* ── STEP: Choice ─────────────────────────────────────── */}
      {step === 'choice' && (
        <div className="flex flex-col flex-1 pt-16 pb-10">
          <div className="flex flex-col items-center gap-4 mb-12">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'radial-gradient(ellipse at 40% 30%, rgba(0,255,127,0.2) 0%, rgba(0,255,127,0.04) 100%)',
                border: '1.5px solid rgba(0,255,127,0.3)',
                boxShadow: '0 0 32px rgba(0,255,127,0.12)',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <polyline points="6,22 6,6 22,22 22,6" stroke="#00FF7F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="text-center">
              <h1 className="text-white text-2xl font-bold tracking-tight">Настрой кошелёк</h1>
              <p className="text-[#3A6045] text-sm mt-1">Выбери способ создания</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 flex-1">
            <button
              onClick={handleCreateNew}
              className="w-full py-5 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex flex-col items-start px-5 gap-1"
              style={{ background: 'rgba(0,255,127,0.07)', border: '1.5px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
            >
              <span className="text-base font-bold">✦ Создать новый кошелёк</span>
              <span className="text-[#3A6045] text-xs font-normal">Сгенерируем 12 слов — ключ от твоих активов</span>
            </button>

            <button
              onClick={handleImport}
              className="w-full py-5 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex flex-col items-start px-5 gap-1"
              style={{ background: '#0D1A10', border: '1.5px solid rgba(0,255,127,0.15)', color: 'white' }}
            >
              <span className="text-base font-bold">Импортировать кошелёк</span>
              <span className="text-[#3A6045] text-xs font-normal">Введи 12 слов от существующего кошелька</span>
            </button>
          </div>

          <p className="text-center text-[#3A6045] text-xs mt-6">
            Твои ключи хранятся только на устройстве. NeuroWallet не имеет доступа к средствам.
          </p>
        </div>
      )}

      {/* ── STEP: Show mnemonic ──────────────────────────────── */}
      {step === 'show-mnemonic' && (
        <div className="flex flex-col flex-1 pt-14 pb-10 gap-6">
          <div>
            <h1 className="text-white text-2xl font-bold">Запиши фразу</h1>
            <p className="text-[#3A6045] text-sm mt-1">12 слов — единственный способ восстановить кошелёк</p>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: 'rgba(255,196,0,0.06)', border: '1px solid rgba(255,196,0,0.22)' }}
          >
            <p className="text-[#FFC400] text-xs leading-relaxed">
              ⚠️ Никогда не делись этими словами. Никто из команды NeuroWallet никогда их не запросит.
            </p>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}
          >
            <div className="grid grid-cols-3 gap-2">
              {words.map((word, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: '#080C09', border: '1px solid rgba(0,255,127,0.1)' }}
                >
                  <span className="text-[#3A6045] text-[10px] w-4 flex-shrink-0">{i + 1}</span>
                  <span className="text-white text-sm font-mono">{word}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleMnemonicConfirm}
            disabled={!canContinue}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: canContinue ? '0 0 24px rgba(0,255,127,0.35)' : 'none' }}
          >
            {canContinue ? 'Я записал — продолжить' : 'Читай внимательно...'}
          </button>
        </div>
      )}

      {/* ── STEP: Verify mnemonic ────────────────────────────── */}
      {step === 'verify-mnemonic' && (
        <div className="flex flex-col flex-1 pt-14 pb-10 gap-6">
          <div>
            <button onClick={() => setStep('show-mnemonic')} className="text-[#3A6045] text-sm mb-4 flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              Назад
            </button>
            <h1 className="text-white text-2xl font-bold">Проверка записи</h1>
            <p className="text-[#3A6045] text-sm mt-1">Введи 3 слова из своей фразы</p>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.12)' }}
          >
            <p className="text-[#3A6045] text-xs leading-relaxed">
              Если ты правильно записал фразу, введи слова ниже. Это гарантирует, что ты сможешь восстановить кошелёк.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {verifyIndices.map((wordIdx, i) => (
              <div key={wordIdx} className="flex flex-col gap-1.5">
                <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">
                  Слово #{wordIdx + 1}
                </label>
                <input
                  type="text"
                  value={verifyInputs[i]}
                  onChange={(e) => {
                    const next = [...verifyInputs];
                    next[i] = e.target.value;
                    setVerifyInputs(next);
                    setError('');
                  }}
                  placeholder={`Введи слово #${wordIdx + 1}`}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full px-4 py-3.5 rounded-xl text-white text-sm outline-none placeholder:text-[#3A6045]"
                  style={{
                    background: '#0D1A10',
                    border: `1px solid ${error && error.includes(`#${wordIdx + 1}`) ? 'rgba(255,60,60,0.4)' : 'rgba(0,255,127,0.15)'}`,
                    caretColor: '#00FF7F',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            ))}
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)', color: '#FF6B6B' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleVerify}
            disabled={verifyInputs.some((v) => !v.trim())}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
          >
            Подтвердить
          </button>
        </div>
      )}

      {/* ── STEP: Import mnemonic ────────────────────────────── */}
      {step === 'import-mnemonic' && (
        <div className="flex flex-col flex-1 pt-14 pb-10 gap-6">
          <div>
            <button onClick={() => setStep('choice')} className="text-[#3A6045] text-sm mb-4 flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              Назад
            </button>
            <h1 className="text-white text-2xl font-bold">Импорт кошелька</h1>
            <p className="text-[#3A6045] text-sm mt-1">Введи 12 слов через пробел</p>
          </div>

          <textarea
            value={importMnemonicInput}
            onChange={(e) => { setImportMnemonicInput(e.target.value); setError(''); }}
            placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
            rows={4}
            className="w-full px-4 py-3.5 rounded-xl text-white text-sm outline-none resize-none placeholder:text-[#3A6045]"
            style={{
              background: '#0D1A10',
              border: '1px solid rgba(0,255,127,0.15)',
              caretColor: '#00FF7F',
              fontFamily: 'monospace',
            }}
          />

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)', color: '#FF6B6B' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleImportContinue}
            disabled={!importMnemonicInput.trim()}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
          >
            Проверить и продолжить
          </button>
        </div>
      )}

      {/* ── STEP: Set password ───────────────────────────────── */}
      {step === 'set-password' && (
        <div className="flex flex-col flex-1 pt-14 pb-10 gap-6">
          <div>
            <h1 className="text-white text-2xl font-bold">Защити кошелёк</h1>
            <p className="text-[#3A6045] text-sm mt-1">Пароль шифрует ключи на устройстве</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">Пароль</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="Минимум 6 символов"
                  className="w-full px-4 py-3.5 pr-12 rounded-xl text-white text-sm outline-none placeholder:text-[#3A6045]"
                  style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)', caretColor: '#00FF7F' }}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#3A6045]">
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">Подтверди пароль</label>
              <input
                type={showPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder="Повтори пароль"
                className="w-full px-4 py-3.5 rounded-xl text-white text-sm outline-none placeholder:text-[#3A6045]"
                style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)', caretColor: '#00FF7F' }}
              />
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)', color: '#FF6B6B' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: '0 0 24px rgba(0,255,127,0.35)' }}
          >
            Создать кошелёк
          </button>
        </div>
      )}

      {/* ── STEP: Generating ─────────────────────────────────── */}
      {step === 'generating' && (
        <div className="flex flex-col flex-1 items-center justify-center gap-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(0,255,127,0.15) 0%, rgba(0,255,127,0.03) 100%)',
              border: '1.5px solid rgba(0,255,127,0.3)',
            }}
          >
            <div
              className="w-8 h-8 rounded-full border-2 border-[#00FF7F] border-t-transparent"
              style={{ animation: 'spin 0.8s linear infinite' }}
            />
          </div>
          <div className="text-center">
            <p className="text-white font-semibold">Генерируем кошелёк...</p>
            <p className="text-[#3A6045] text-sm mt-1">Это займёт несколько секунд</p>
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </main>
  );
}
