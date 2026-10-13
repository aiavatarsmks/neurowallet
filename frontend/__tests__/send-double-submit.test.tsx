/**
 * CryptoSendScreen: one confirmation = one transfer.
 *
 * Decrypting the key takes seconds (scrypt N=2^17) while the UI stays
 * responsive. Before the fix a double Enter (or key repeat) and a double tap on
 * "Confirm & send" each started handleConfirmSend again: for TRX and USDT
 * TRC-20 that meant two distinct on-chain transfers. The chain library is
 * mocked; the send never resolves within the test, like a slow decrypt.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  auth: { user: { id: 'u1' }, isDemo: false, isLoading: false },
  sendUsdtTrc20: vi.fn(),
  sendTrx: vi.fn(),
}));

const TRON_TO = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => H.auth }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'en' }) }));
vi.mock('@/contexts/DisplayCurrencyContext', () => ({
  useDisplayCurrency: () => ({ formatFiat: (v: number) => `€${v.toFixed(2)}` }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackOnce: vi.fn(), newTraceId: () => 'trace-1' }));
vi.mock('@/lib/notifications-client', () => ({ emitNotification: vi.fn() }));
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/lib/crypto/keystore-migration', () => ({ upgradeStoredKeystoreIfWeak: vi.fn() }));
vi.mock('@/lib/neura/explain-client', () => ({ fetchExplanation: vi.fn() }));
vi.mock('@/lib/name-resolvers', () => ({ looksLikeTonDnsName: () => false, resolveName: vi.fn() }));
vi.mock('@/lib/policy-engine', () => ({ policyEngineEnabled: () => false }));
vi.mock('@/lib/policies-client', () => ({ fetchPolicies: vi.fn() }));
vi.mock('@/lib/risk/engine', () => ({ assessRecipient: () => ({ level: 'ok', reasons: [], overridable: true }) }));
vi.mock('@/lib/crypto/balances', () => ({
  MARKET_REFRESH_MS: 60_000,
  fetchRealBalances: vi.fn(async () => ({
    eth: 1, btc: 0, sol: 0, usdt: 0, trx: 100, usdtTrc: 50, ton: 0, usdtTon: 0,
    ethEur: 2800, btcEur: 55000, solEur: 120, trxEur: 0.22, tonEur: 3.5,
  })),
}));
vi.mock('@/lib/crypto/simulate', () => ({
  FEE_CURRENCY: {
    ETH: { coin: 'ETH' }, USDT: { coin: 'ETH' }, BTC: { coin: 'BTC' }, SOL: { coin: 'SOL' },
    TRX: { coin: 'TRX' }, TRC20: { coin: 'TRX' }, TON: { coin: 'TON' }, USDT_TON: { coin: 'TON' },
  },
  estimateFeeNative: vi.fn(async () => 0),
  isBlocked: () => false,
  simulateTransfer: vi.fn(async () => ({
    status: 'ok', feeNative: 14, feeCurrency: 'TRX', feeEur: 3, balanceAfter: 49, warnings: [],
  })),
}));
vi.mock('@/lib/crypto/transactions', () => ({
  sendEth: vi.fn(), sendUsdt: vi.fn(), sendSol: vi.fn(), sendBtc: vi.fn(), sendTon: vi.fn(), sendUsdtTon: vi.fn(),
  sendUsdtTrc20: H.sendUsdtTrc20,
  sendTrx: H.sendTrx,
  isValidEthAddress: () => false,
  isValidSolAddress: () => false,
  isValidBtcAddress: () => false,
  isValidTonAddress: () => false,
  isValidTronAddress: (a: string) => a === TRON_TO,
}));
vi.mock('@/lib/crypto/btc-tx', () => ({ sendBtc: vi.fn() }));

import { CryptoSendScreen } from '@/components/CryptoSendScreen';

/** form → review → password step, with the password typed in. */
async function reachPasswordStep(coin: 'TRC20' | 'TRX') {
  render(<CryptoSendScreen initialCoin={coin} initialAddress={TRON_TO} initialAmount="1" />);
  // Balances load asynchronously; Continue enables once the amount is covered.
  const cont = await screen.findByText('csContinue');
  await waitFor(() => expect(cont).not.toBeDisabled());
  fireEvent.click(cont);
  const toPassword = await screen.findByText('csEnterPassword');
  await waitFor(() => expect(toPassword.closest('button')).not.toBeDisabled());
  fireEvent.click(toPassword);
  const input = await screen.findByPlaceholderText('csPasswordPlaceholder');
  fireEvent.change(input, { target: { value: 'correct horse' } });
  return input as HTMLInputElement;
}

/**
 * Two native events inside ONE act(): React has not re-rendered in between, so
 * the second handler still sees the stale `sending === false` closure and an
 * enabled DOM node. Only the synchronous ref guard can stop it.
 */
function enter(el: Element) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('CryptoSendScreen double-submit guard', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wallet_eth_address', '0x' + '1'.repeat(40));
    localStorage.setItem('wallet_tron_address', 'TXYZ');
    localStorage.setItem('wallet_keystore', '{"fake":"keystore"}');
    localStorage.setItem('wallet_tron_enc', 'tron-enc-blob');
    H.sendUsdtTrc20.mockReset().mockImplementation(() => new Promise(() => { /* slow decrypt */ }));
    H.sendTrx.mockReset().mockImplementation(() => new Promise(() => {}));
  });

  it('double Enter in the password field starts exactly one USDT TRC-20 send', async () => {
    const input = await reachPasswordStep('TRC20');
    await act(async () => {
      enter(input);
      enter(input);
    });
    expect(H.sendUsdtTrc20).toHaveBeenCalledTimes(1);
    // While the attempt is in flight the field and the button are locked.
    expect(input).toBeDisabled();
    expect(screen.getByText('csSending').closest('button')).toBeDisabled();
    // Key repeat and further Enters after the re-render are ignored as well.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', repeat: true });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(H.sendUsdtTrc20).toHaveBeenCalledTimes(1);
  });

  it('double click on Confirm & send starts exactly one TRX send', async () => {
    await reachPasswordStep('TRX');
    const btn = screen.getByText('csConfirmAndSend').closest('button')!;
    await act(async () => {
      click(btn);
      click(btn);
    });
    expect(H.sendTrx).toHaveBeenCalledTimes(1);
  });

  it('Enter and a click in the same tick still send once', async () => {
    const input = await reachPasswordStep('TRC20');
    const btn = screen.getByText('csConfirmAndSend').closest('button')!;
    await act(async () => {
      enter(input);
      click(btn);
    });
    expect(H.sendUsdtTrc20).toHaveBeenCalledTimes(1);
  });

  it('after a failed attempt the guard is released and a retry works', async () => {
    H.sendTrx.mockReset()
      .mockRejectedValueOnce(new Error('TronGrid недоступен. Проверь соединение и попробуй позже.'))
      .mockImplementation(() => new Promise(() => {}));
    const input = await reachPasswordStep('TRX');
    await act(async () => { enter(input); });
    await screen.findByText('csErrTrongridDown');
    await waitFor(() => expect(input).not.toBeDisabled());
    await act(async () => { enter(input); });
    expect(H.sendTrx).toHaveBeenCalledTimes(2);
  });
});
