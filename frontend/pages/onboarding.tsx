import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { generateMnemonic, importWalletFromMnemonic } from '@/lib/crypto/wallet';
import { track } from '@/lib/analytics';
import { getPendingClaim, completeClaim, clearPendingClaim } from '@/lib/claim-client';
import { PinSetup } from '@/components/PinSetup';

type Step = 'choice' | 'show-mnemonic' | 'verify-mnemonic' | 'import-mnemonic' | 'set-password' | 'generating' | 'pin-setup';

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

function useTgSafeTop(): number {
  const [top, setTop] = useState(80);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tg = (window as Window & { Telegram?: { WebApp?: { safeAreaInset?: { top?: number }; contentSafeAreaInset?: { top?: number } } } }).Telegram?.WebApp;
    const safe = (tg?.safeAreaInset?.top ?? 0) + (tg?.contentSafeAreaInset?.top ?? 0);
    setTop(Math.max(80, safe + 20));
  }, []);
  return top;
}

export default function OnboardingWalletPage() {
  const router = useRouter();
  const { user, isDemo, isLoading, enterDemo } = useAuth();
  const { t } = useLanguage();
  const safeTop = useTgSafeTop();

  const [step, setStep] = useState<Step>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonicInput, setImportMnemonicInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyMnemonic = () => {
    if (!mnemonic) return;
    navigator.clipboard.writeText(mnemonic).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Verification step state
  const [verifyIndices, setVerifyIndices]   = useState<number[]>([]);
  const [verifyInputs,  setVerifyInputs]    = useState<string[]>(['', '', '']);

  useEffect(() => { track('onboarding_started'); }, []);

  const recoverApplied = useRef(false);

  // Guard: redirect if already has wallet or not authenticated
  useEffect(() => {
    if (isLoading || !router.isReady) return;
    if (!user && !isDemo) {
      router.replace('/auth');
      return;
    }
    // Recovery entry (?recover=1): the address may still be in localStorage
    // while the keys are missing/unverifiable (e.g. legacy wallet from before
    // the per-chain enc scheme, or the origin move to neurowallet.tech). Force
    // the seed re-import instead of bouncing back to /wallet — otherwise the
    // user is trapped: /wallet won't send them here, and here would send them
    // back to /wallet. Apply ONCE — the ?recover=1 param stays in the URL, so
    // without the ref a later effect re-run would yank the user out of the
    // set-password / pin-setup step back to import-mnemonic.
    if (router.query.recover === '1') {
      if (!recoverApplied.current) {
        recoverApplied.current = true;
        setStep('import-mnemonic');
        setError('');
      }
      return;
    }
    if (typeof window !== 'undefined' && localStorage.getItem('wallet_eth_address')) {
      router.replace('/wallet');
    }
  }, [isLoading, user, isDemo, router.isReady, router.query.recover, router]);

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

  const handleDemo = () => {
    enterDemo();
    router.push('/wallet');
  };

  const handleImportContinue = () => {
    const words = importMnemonicInput.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12) {
      setError(t('onbWordCountError'));
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
        setError(t('onbWordWrong').replace('{n}', String(verifyIndices[i] + 1)));
        return;
      }
    }
    setError('');
    setStep('set-password');
  };

  const handleGenerate = async () => {
    if (!password) { setError(t('onbEnterPassword')); return; }
    if (password.length < 6) { setError(t('onbPasswordMin')); return; }
    if (password !== confirmPassword) { setError(t('onbPasswordMismatch')); return; }

    setStep('generating');
    setError('');

    try {
      const wallet = await importWalletFromMnemonic(mnemonic, password);
      if (typeof window !== 'undefined') {
        localStorage.setItem('wallet_eth_address',  wallet.eth);
        localStorage.setItem('wallet_sol_address',  wallet.sol);
        localStorage.setItem('wallet_btc_address',  wallet.btc);
        localStorage.setItem('wallet_tron_address', wallet.tron);
        localStorage.setItem('wallet_ton_address',  wallet.ton);
        localStorage.setItem('wallet_keystore',     wallet.keystore);
        localStorage.setItem('wallet_sol_enc',       wallet.solEnc);
        localStorage.setItem('wallet_btc_enc',       wallet.btcEnc);
        localStorage.setItem('wallet_tron_enc',      wallet.tronEnc);
        localStorage.setItem('wallet_ton_enc',       wallet.tonEnc);
      }
      track(importMnemonicInput.trim() ? 'wallet_imported' : 'wallet_created');

      // Claim-link handoff (2.8): if this wallet was created to claim a link,
      // record the activation and complete the (demo) claim. Fire-and-forget.
      const pending = getPendingClaim();
      if (pending) {
        track('claim_wallet_created', { demo: true });
        void completeClaim(pending.ref, pending.secret).finally(() => clearPendingClaim());
      }

      setStep('pin-setup');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('onbGenError'));
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

  // PIN setup step — rendered outside main layout
  if (step === 'pin-setup') {
    return (
      <PinSetup
        walletPassword={password}
        onComplete={() => { track('onboarding_completed', { pin: true }); router.push('/wallet'); }}
        allowSkip={false}
      />
    );
  }

  const words = mnemonic.split(' ');

  return (
    <main className="min-h-screen flex flex-col max-w-[430px] mx-auto px-6" style={{ backgroundColor: '#080C09' }}>

      {/* ── STEP: Choice ─────────────────────────────────────── */}
      {step === 'choice' && (
        <div className="flex flex-col flex-1 pb-10" style={{ paddingTop: safeTop }}>
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
              <h1 className="text-white text-2xl font-bold tracking-tight">{t('onbChoiceTitle')}</h1>
              <p className="text-[#3A6045] text-sm mt-1">{t('onbChoiceSubtitle')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 flex-1">
            <button
              onClick={handleCreateNew}
              className="w-full py-5 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex flex-col items-start px-5 gap-1"
              style={{ background: 'rgba(0,255,127,0.07)', border: '1.5px solid rgba(0,255,127,0.3)', color: '#00FF7F' }}
            >
              <span className="text-base font-bold">{t('onbCreateNewTitle')}</span>
              <span className="text-[#3A6045] text-xs font-normal">{t('onbCreateNewSubtitle')}</span>
            </button>

            <button
              onClick={handleImport}
              className="w-full py-5 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex flex-col items-start px-5 gap-1"
              style={{ background: '#0D1A10', border: '1.5px solid rgba(0,255,127,0.15)', color: 'white' }}
            >
              <span className="text-base font-bold">{t('onbImportTitle')}</span>
              <span className="text-[#3A6045] text-xs font-normal">{t('onbImportSubtitle')}</span>
            </button>

            <button
              onClick={handleDemo}
              className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{
                background: 'transparent',
                border: '1.5px solid rgba(0,255,127,0.28)',
                color: '#00FF7F',
              }}
            >
              {t('landingDemoMode')}
            </button>
          </div>

          <p className="text-center text-[#3A6045] text-xs mt-6">
            {t('authDemoHint')}
          </p>
          <p className="text-center text-[#3A6045] text-xs mt-2">
            {t('onbChoiceFooter')}
          </p>
        </div>
      )}

      {/* ── STEP: Show mnemonic ──────────────────────────────── */}
      {step === 'show-mnemonic' && (
        <div className="flex flex-col flex-1 pb-10 gap-5" style={{ paddingTop: safeTop }}>
          <div>
            <h1 className="text-white text-2xl font-bold">{t('onbShowTitle')}</h1>
            <p className="text-[#3A6045] text-sm mt-1">{t('onbShowSubtitle')}</p>
          </div>

          <div
            className="rounded-2xl p-3"
            style={{ background: 'rgba(255,196,0,0.06)', border: '1px solid rgba(255,196,0,0.22)' }}
          >
            <p className="text-[#FFC400] text-xs leading-relaxed">
              {t('onbShowWarning')}
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
                  className="flex items-center gap-1.5 rounded-xl px-2 py-1.5"
                  style={{ background: '#080C09', border: '1px solid rgba(0,255,127,0.1)' }}
                >
                  <span className="text-[#3A6045] text-[9px] w-3 flex-shrink-0 leading-none">{i + 1}</span>
                  <span className="text-white text-[11px] font-mono leading-tight break-all">{word}</span>
                </div>
              ))}
            </div>

            {/* Copy all words */}
            <button
              onClick={handleCopyMnemonic}
              className="w-full mt-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
              style={{
                background: copied ? 'rgba(0,255,127,0.15)' : 'rgba(0,255,127,0.07)',
                border: '1px solid rgba(0,255,127,0.2)',
                color: copied ? '#00FF7F' : '#3A6045',
              }}
            >
              {copied ? (
                <>{t('onbCopied')}</>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  {t('onbCopyAll')}
                </>
              )}
            </button>
          </div>

          <button
            onClick={handleMnemonicConfirm}
            disabled={!canContinue}
            className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: '#00FF7F', color: '#080C09', boxShadow: canContinue ? '0 0 24px rgba(0,255,127,0.35)' : 'none' }}
          >
            {canContinue ? t('onbIWroteItDown') : t('onbReadCarefully')}
          </button>
        </div>
      )}

      {/* ── STEP: Verify mnemonic ────────────────────────────── */}
      {step === 'verify-mnemonic' && (
        <div className="flex flex-col flex-1 pb-10 gap-6" style={{ paddingTop: safeTop }}>
          <div>
            <button onClick={() => setStep('show-mnemonic')} className="text-[#3A6045] text-sm mb-4 flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              {t('onbBack')}
            </button>
            <h1 className="text-white text-2xl font-bold">{t('onbVerifyTitle')}</h1>
            <p className="text-[#3A6045] text-sm mt-1">{t('onbVerifySubtitle')}</p>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: 'rgba(0,255,127,0.04)', border: '1px solid rgba(0,255,127,0.12)' }}
          >
            <p className="text-[#3A6045] text-xs leading-relaxed">
              {t('onbVerifyHint')}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {verifyIndices.map((wordIdx, i) => (
              <div key={wordIdx} className="flex flex-col gap-1.5">
                <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">
                  {t('onbWordLabel').replace('{n}', String(wordIdx + 1))}
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
                  placeholder={t('onbWordPlaceholder').replace('{n}', String(wordIdx + 1))}
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
            {t('onbConfirm')}
          </button>
        </div>
      )}

      {/* ── STEP: Import mnemonic ────────────────────────────── */}
      {step === 'import-mnemonic' && (
        <div className="flex flex-col flex-1 pb-10 gap-6" style={{ paddingTop: safeTop }}>
          <div>
            <button onClick={() => setStep('choice')} className="text-[#3A6045] text-sm mb-4 flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              {t('onbBack')}
            </button>
            <h1 className="text-white text-2xl font-bold">{t('onbImportPageTitle')}</h1>
            <p className="text-[#3A6045] text-sm mt-1">{t('onbImportPageSubtitle')}</p>
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
            {t('onbImportContinue')}
          </button>
        </div>
      )}

      {/* ── STEP: Set password ───────────────────────────────── */}
      {step === 'set-password' && (
        <div className="flex flex-col flex-1 pb-10 gap-6" style={{ paddingTop: safeTop }}>
          <div>
            <h1 className="text-white text-2xl font-bold">{t('onbProtectTitle')}</h1>
            <p className="text-[#3A6045] text-sm mt-1">{t('onbProtectSubtitle')}</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">{t('onbPasswordLabel')}</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder={t('authPasswordPlaceholder')}
                  className="w-full px-4 py-3.5 pr-12 rounded-xl text-white text-sm outline-none placeholder:text-[#3A6045]"
                  style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)', caretColor: '#00FF7F' }}
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#3A6045]">
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[#3A6045] text-xs font-medium uppercase tracking-wider px-1">{t('onbConfirmPasswordLabel')}</label>
              <input
                type={showPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder={t('onbConfirmPasswordPlaceholder')}
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
            {t('onbCreateWallet')}
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
            <p className="text-white font-semibold">{t('onbGenerating')}</p>
            <p className="text-[#3A6045] text-sm mt-1">{t('onbGeneratingSubtitle')}</p>
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </main>
  );
}
