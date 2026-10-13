/**
 * components/ErrorBoundary.tsx — top-level crash guard.
 *
 * Why: a client-side render/effect throw anywhere in the tree otherwise
 * white-screens the whole Mini App ("Application error: a client-side
 * exception has occurred") with no way out — fatal for a wallet, and it
 * hides the actual error. This boundary:
 *   1. keeps the app recoverable: "Reload" is the primary action;
 *   2. SURFACES the error message + stack on-screen so a tester can report
 *      it (there is no Sentry wired), and also console.errors it;
 *   3. offers, as a secondary action behind a two-step confirmation, a reset
 *      that snapshots the wallet entries (nw_wallet_backup_v1), removes the
 *      keys from this device and opens the seed re-import (?recover=1).
 *      A crash does not delete anything by itself, and the app never stores
 *      the seed, so only the user's written seed phrase can restore access
 *      after a reset. The copy says exactly that, and that the encrypted
 *      backup stays on the device for 30 days before it is purged.
 *
 * Intentionally free of providers/hooks (no LanguageContext, no router) so it
 * still works even if a provider is what threw. Language is detected the same
 * way LanguageContext does it; strings come from the static i18n table.
 */

import React from 'react';
import { translations, type Lang, type TranslationKey } from '@/lib/i18n';
import { removeWalletFromDevice } from '@/lib/legacy-storage-cleanup';

function detectLang(): Lang {
  try {
    if (typeof window === 'undefined') return 'ru';
    const stored = localStorage.getItem('wallet_language');
    if (stored === 'ru' || stored === 'en') return stored;
    const tg = (window as Window & { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } })
      .Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    if (tg) return tg === 'ru' ? 'ru' : 'en';
    return (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  } catch {
    return 'ru';
  }
}

interface State {
  error: Error | null;
  info: string;
  confirmReset: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '', confirmReset: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console too (Vercel logs never see client-side exceptions).
    console.error('[ErrorBoundary] caught:', error, info);
    this.setState({ info: info.componentStack ?? '' });
  }

  private reload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  private askReset = () => this.setState({ confirmReset: true });

  private cancelReset = () => this.setState({ confirmReset: false });

  /** Only reachable from the confirmation step. */
  private safeReset = () => {
    if (typeof window === 'undefined') return;
    removeWalletFromDevice(); // snapshot to nw_wallet_backup_v1, then remove
    // Re-enter recovery: seed re-import, bypassing the stale-address bounce.
    window.location.href = '/onboarding?recover=1';
  };

  render() {
    const { error, info, confirmReset } = this.state;
    if (!error) return this.props.children;

    const dict = translations[detectLang()] as Record<TranslationKey, string>;
    const t = (k: TranslationKey): string => dict[k] ?? translations.ru[k];

    return (
      <div
        style={{
          minHeight: '100vh', background: '#080C09', color: '#fff',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '24px', maxWidth: 430, margin: '0 auto',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <p style={{ fontSize: 18, fontWeight: 600, textAlign: 'center' }}>
          {t('ebTitle')}
        </p>
        <p style={{ fontSize: 13, color: '#7FBF9A', marginTop: 4, textAlign: 'center' }}>
          {t('ebSubtitle')}
        </p>

        <pre
          style={{
            marginTop: 16, width: '100%', maxHeight: 180, overflow: 'auto',
            background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)',
            borderRadius: 12, padding: 12, fontSize: 11, color: '#FF6B6B',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {error.message}
          {error.stack ? '\n\n' + error.stack : ''}
          {info ? '\n\nComponent stack:' + info : ''}
        </pre>

        <button
          onClick={this.reload}
          style={{
            marginTop: 16, width: '100%', padding: '14px', borderRadius: 16,
            background: '#00FF7F', color: '#080C09', fontWeight: 600, fontSize: 14,
            border: 'none',
          }}
        >
          {t('ebReload')}
        </button>

        {confirmReset ? (
          <div
            data-testid="eb-reset-confirm"
            style={{
              marginTop: 12, width: '100%', padding: 14, borderRadius: 16,
              background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.3)',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <p style={{ fontSize: 13, color: '#F7931A', lineHeight: 1.45 }}>{t('keysDeleteWarn')}</p>
            <p style={{ fontSize: 12, color: '#F7931A', lineHeight: 1.45 }}>{t('keysDeleteBackupNote')}</p>
            <button
              onClick={this.safeReset}
              style={{
                width: '100%', padding: '12px', borderRadius: 12,
                background: '#F7931A', color: '#080C09', fontWeight: 600, fontSize: 13, border: 'none',
              }}
            >
              {t('keysDeleteConfirm')}
            </button>
            <button
              onClick={this.cancelReset}
              style={{
                width: '100%', padding: '10px', borderRadius: 12,
                background: 'transparent', color: '#00FF7F', fontWeight: 600, fontSize: 13,
                border: '1px solid rgba(0,255,127,0.18)',
              }}
            >
              {t('keysDeleteCancel')}
            </button>
          </div>
        ) : (
          <button
            onClick={this.askReset}
            style={{
              marginTop: 12, width: '100%', padding: '10px', borderRadius: 12,
              background: 'transparent', color: '#F7931A', fontWeight: 500, fontSize: 12,
              border: 'none', textDecoration: 'underline',
            }}
          >
            {t('ebResetCta')}
          </button>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
