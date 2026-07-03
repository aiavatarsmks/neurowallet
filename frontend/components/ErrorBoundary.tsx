/**
 * components/ErrorBoundary.tsx — top-level crash guard.
 *
 * Why: a client-side render/effect throw anywhere in the tree otherwise
 * white-screens the whole Mini App ("Application error: a client-side
 * exception has occurred") with no way out — fatal for a wallet, and it
 * hides the actual error. This boundary:
 *   1. keeps the app recoverable (Reload / safe reset buttons),
 *   2. SURFACES the error message + stack on-screen so a tester can report
 *      it (there is no Sentry wired), and also console.errors it,
 *   3. offers a safe reset that clears wallet/PIN state and re-enters the
 *      seed re-import flow (?recover=1) without leaving half-written data.
 *
 * Intentionally dependency-free (no i18n/router hooks) so it still works
 * even if a provider is what threw. Text is RU-primary + EN subtitle.
 */

import React from 'react';

// Keys the onboarding/import flow and PIN layer write. Kept in sync with
// lib/crypto/wallet.ts (LS) and lib/pin.ts. Cleared on an explicit safe reset.
const WALLET_LS_KEYS = [
  'wallet_eth_address', 'wallet_sol_address', 'wallet_btc_address',
  'wallet_tron_address', 'wallet_ton_address', 'wallet_keystore',
  'wallet_sol_enc', 'wallet_btc_enc', 'wallet_tron_enc', 'wallet_ton_enc',
  'wallet_pin_blob', 'wallet_pin_attempts', 'wallet_pin_lockout_until',
  // legacy XOR-era blobs, if any lingered
  'wallet_sol_xor', 'wallet_btc_xor', 'wallet_tron_xor', 'wallet_ton_xor',
];

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' };

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

  private safeReset = () => {
    if (typeof window === 'undefined') return;
    try {
      for (const k of WALLET_LS_KEYS) localStorage.removeItem(k);
    } catch { /* localStorage may be unavailable */ }
    // Re-enter recovery: seed re-import, bypassing the stale-address bounce.
    window.location.href = '/onboarding?recover=1';
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

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
          Что-то пошло не так
        </p>
        <p style={{ fontSize: 13, color: '#3A6045', marginTop: 4, textAlign: 'center' }}>
          Something went wrong — the app is recoverable, your seed phrase is safe.
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
          Перезагрузить / Reload
        </button>
        <button
          onClick={this.safeReset}
          style={{
            marginTop: 10, width: '100%', padding: '14px', borderRadius: 16,
            background: 'transparent', color: '#F7931A', fontWeight: 600, fontSize: 13,
            border: '1px solid rgba(247,147,26,0.3)',
          }}
        >
          Сбросить и переимпортировать по seed
        </button>
        <p style={{ fontSize: 11, color: '#3A6045', marginTop: 8, textAlign: 'center', opacity: 0.7 }}>
          Сброс очистит локальные данные кошелька на этом устройстве.
          Нужна seed-фраза для восстановления.
        </p>
      </div>
    );
  }
}

export default ErrorBoundary;
