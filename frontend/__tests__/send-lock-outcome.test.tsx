/**
 * CryptoSendScreen, night review (UI):
 *  - an unknown broadcast outcome (BroadcastOutcomeUnknownError) is never shown
 *    as an error: done screen in a "don't resend" state, the hash is polled;
 *  - the app-wide send lock: leaving the screen mid-send and opening it again
 *    cannot start a second transfer;
 *  - the previous-transfer banner (nw_last_send_v1) with its live status;
 *  - "New transaction" drops the shared balance cache and waits for a fresh
 *    balance round before Continue is enabled.
 * Chain libraries are mocked; nothing here touches a network.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({
  auth: { user: { id: 'u1' }, isDemo: false, isLoading: false },
  sendTrx: vi.fn(),
  track: vi.fn(),
  useTxStatus: vi.fn(),
  status: { state: 'pending', polling: true, timedOut: false } as Record<string, unknown>,
  fetchRealBalances: vi.fn(),
  resetSharedBalances: vi.fn(),
}));

const TRON_TO = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const TRON_TXID = 'ab'.repeat(32);
const BALANCES = {
  eth: 1, btc: 0, sol: 0, usdt: 0, trx: 100, usdtTrc: 50, ton: 0, usdtTon: 0,
  ethEur: 2800, btcEur: 55000, solEur: 120, trxEur: 0.22, tonEur: 3.5, unavailable: [],
};
const T: Record<string, string> = { csLastSendLine: 'Prev: {amt} {coin} → {to}. Status: {status}' };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => H.auth }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => T[k] ?? k, lang: 'en' }),
}));
vi.mock('@/contexts/DisplayCurrencyContext', () => ({
  useDisplayCurrency: () => ({ formatFiat: (v: number) => `€${v.toFixed(2)}` }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('@/lib/analytics', () => ({ track: H.track, trackOnce: vi.fn(), newTraceId: () => 'trace-1' }));
vi.mock('@/lib/notifications-client', () => ({ emitNotification: vi.fn() }));
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/lib/crypto/keystore-migration', () => ({ upgradeStoredKeystoreIfWeak: vi.fn() }));
vi.mock('@/lib/neura/explain-client', () => ({ fetchExplanation: vi.fn() }));
vi.mock('@/lib/name-resolvers', () => ({ looksLikeTonDnsName: () => false, resolveName: vi.fn() }));
vi.mock('@/lib/policy-engine', () => ({ policyEngineEnabled: () => false }));
vi.mock('@/lib/policies-client', () => ({ fetchPolicies: vi.fn() }));
vi.mock('@/lib/risk/engine', () => ({ assessRecipient: () => ({ level: 'ok', reasons: [], overridable: true }) }));
vi.mock('@/hooks/useTxStatus', () => ({ useTxStatus: H.useTxStatus }));
vi.mock('@/lib/crypto/balances', () => ({
  MARKET_REFRESH_MS: 60_000,
  fetchRealBalances: H.fetchRealBalances,
  resetSharedBalances: H.resetSharedBalances,
}));
vi.mock('@/lib/crypto/simulate', () => ({
  FEE_CURRENCY: {
    ETH: { coin: 'ETH' }, USDT: { coin: 'ETH' }, BTC: { coin: 'BTC' }, SOL: { coin: 'SOL' },
    TRX: { coin: 'TRX' }, TRC20: { coin: 'TRX' }, TON: { coin: 'TON' }, USDT_TON: { coin: 'TON' },
  },
  estimateFeeNative: vi.fn(async () => 0),
  isBlocked: () => false,
  simulateTransfer: vi.fn(async () => ({
    status: 'ok', feeNative: 1, feeCurrency: 'TRX', feeEur: 0.2, balanceAfter: 98, warnings: [],
  })),
}));
vi.mock('@/lib/crypto/transactions', () => ({
  sendEth: vi.fn(), sendUsdt: vi.fn(), sendSol: vi.fn(), sendTon: vi.fn(), sendUsdtTon: vi.fn(), sendUsdtTrc20: vi.fn(),
  sendTrx: H.sendTrx,
  isValidEthAddress: () => false,
  isValidSolAddress: () => false,
  isValidBtcAddress: () => false,
  isValidTonAddress: () => false,
  isValidTronAddress: (a: string) => a === TRON_TO,
}));
vi.mock('@/lib/crypto/btc-tx', () => ({ sendBtc: vi.fn(), btcErrorCode: () => null, BTC_MAX_FEE_RATE_SAT_VB: 500 }));

import { CryptoSendScreen } from '@/components/CryptoSendScreen';
import { BroadcastOutcomeUnknownError } from '@/lib/crypto/broadcast-error';
import { sendLock, resetSendLockForTests } from '@/lib/send-lock';
import { LAST_SEND_STORAGE_KEY } from '@/lib/last-send';

/** form → review → password → confirm (the click runs inside act). */
async function sendThrough(amount = '1') {
  const view = render(<CryptoSendScreen initialCoin="TRX" initialAddress={TRON_TO} initialAmount={amount} />);
  const cont = await screen.findByText('csContinue');
  await waitFor(() => expect(cont).not.toBeDisabled());
  fireEvent.click(cont);
  const toPassword = await screen.findByText('csEnterPassword');
  await waitFor(() => expect(toPassword.closest('button')).not.toBeDisabled());
  fireEvent.click(toPassword);
  const input = await screen.findByPlaceholderText('csPasswordPlaceholder');
  fireEvent.change(input, { target: { value: 'pw' } });
  await act(async () => { fireEvent.click(screen.getByText('csConfirmAndSend')); });
  return view;
}

const lastHookArgs = () => H.useTxStatus.mock.calls[H.useTxStatus.mock.calls.length - 1][0];
const storedLastSend = () => JSON.parse(localStorage.getItem(LAST_SEND_STORAGE_KEY) ?? 'null');

beforeEach(() => {
  resetSendLockForTests();
  localStorage.clear();
  localStorage.setItem('wallet_eth_address', '0x' + '1'.repeat(40));
  localStorage.setItem('wallet_tron_address', 'TmyTronWallet');
  localStorage.setItem('wallet_keystore', '{"fake":"keystore"}');
  localStorage.setItem('wallet_tron_enc', 'tron-enc-blob');
  H.auth = { user: { id: 'u1' }, isDemo: false, isLoading: false };
  H.sendTrx.mockReset().mockResolvedValue(TRON_TXID);
  H.track.mockReset();
  H.status = { state: 'pending', polling: true, timedOut: false };
  H.useTxStatus.mockReset().mockImplementation(() => H.status);
  H.fetchRealBalances.mockReset().mockImplementation(async () => BALANCES);
  H.resetSharedBalances.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('broadcast outcome unknown', () => {
  it('shows the done screen in the unknown state: no error text, one send, the hash is polled', async () => {
    H.sendTrx.mockRejectedValue(new BroadcastOutcomeUnknownError('0xabc…'));
    await sendThrough();

    expect(await screen.findByTestId('send-outcome-unknown')).toBeInTheDocument();
    expect(screen.getByText('csOutcomeUnknownTitle')).toBeInTheDocument();
    expect(screen.getByText('csOutcomeUnknownText')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/csErr/);
    expect(screen.queryByText('csSent')).not.toBeInTheDocument();
    // The Neura note says "sent": not while the outcome is open.
    expect(screen.queryByText('csNeuraDoneTrx')).not.toBeInTheDocument();
    expect(H.sendTrx).toHaveBeenCalledTimes(1);

    expect(lastHookArgs()).toMatchObject({ coin: 'TRX', hash: '0xabc…', enabled: true });
    expect(screen.getByText('csStatusPending')).toBeInTheDocument();
    // No new analytics event: send_failed with a reason code (server allowlist).
    expect(H.track).toHaveBeenCalledWith('send_failed', { coin: 'TRX', reason_code: 'outcome_unknown' }, 'trace-1');
    expect(H.track.mock.calls.some((c) => c[0] === 'send_succeeded')).toBe(false);
    // Remembered for the previous-transfer banner, recipient in short form only.
    expect(storedLastSend()).toMatchObject({ coin: 'TRX', hash: '0xabc…', amount: '1', to: 'TUEZ…WYdH' });
    expect(sendLock.isLocked()).toBe(false);
  });

  it('confirmed by polling → the normal success view', async () => {
    H.sendTrx.mockRejectedValue(new BroadcastOutcomeUnknownError('0xabc…'));
    const view = await sendThrough();
    await screen.findByTestId('send-outcome-unknown');
    H.status = { state: 'confirmed', polling: false, timedOut: false };
    view.rerender(<CryptoSendScreen initialCoin="TRX" initialAddress={TRON_TO} initialAmount="1" />);
    expect(await screen.findByText('csSent')).toBeInTheDocument();
    expect(screen.getByText('csStatusConfirmed')).toBeInTheDocument();
    expect(screen.queryByText('csOutcomeUnknownTitle')).not.toBeInTheDocument();
    expect(screen.getByText('csNeuraDoneTrx')).toBeInTheDocument();
  });

  it('still unclear when polling stops → keeps the warning and points to History', async () => {
    H.sendTrx.mockRejectedValue(new BroadcastOutcomeUnknownError('0xabc…'));
    const view = await sendThrough();
    await screen.findByTestId('send-outcome-unknown');
    expect(screen.queryByText('csOutcomeUnknownCheckHistory')).not.toBeInTheDocument();
    H.status = { state: 'pending', polling: false, timedOut: true };
    view.rerender(<CryptoSendScreen initialCoin="TRX" initialAddress={TRON_TO} initialAmount="1" />);
    expect(await screen.findByText('csOutcomeUnknownCheckHistory')).toBeInTheDocument();
    expect(screen.getByText('csOutcomeUnknownTitle')).toBeInTheDocument();
  });

  it('a plain broadcast error is still an error (not the unknown state)', async () => {
    H.sendTrx.mockRejectedValue(new Error('TronGrid недоступен. Проверь соединение и попробуй позже.'));
    await sendThrough();
    expect(await screen.findByText('csErrTrongridDown')).toBeInTheDocument();
    expect(screen.queryByTestId('send-outcome-unknown')).not.toBeInTheDocument();
    expect(localStorage.getItem(LAST_SEND_STORAGE_KEY)).toBeNull();
  });
});

describe('send lock: leaving the screen mid-send', () => {
  it('a reopened screen cannot start a second transfer while the first is in flight', async () => {
    let finishFirst: (hash: string) => void = () => {};
    H.sendTrx.mockImplementationOnce(() => new Promise<string>((resolve) => { finishFirst = resolve; }));

    const first = await sendThrough();
    expect(H.sendTrx).toHaveBeenCalledTimes(1);
    expect(sendLock.isLocked()).toBe(true);
    first.unmount(); // user left the tab during decrypt + broadcast

    const second = await sendThrough();
    expect(H.sendTrx).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('csSendInProgress')).toBeInTheDocument();

    // The first send completes in the background: the lock is released and
    // the transfer is remembered for the next time the screen opens.
    await act(async () => { finishFirst(TRON_TXID); });
    expect(sendLock.isLocked()).toBe(false);
    expect(storedLastSend()).toMatchObject({ coin: 'TRX', hash: TRON_TXID, amount: '1', to: 'TUEZ…WYdH' });
    second.unmount();

    render(<CryptoSendScreen initialCoin="TRX" initialAddress="" initialAmount="" />);
    const banner = await screen.findByTestId('last-send-banner');
    expect(banner).toHaveTextContent('Prev: 1 TRX → TUEZ…WYdH. Status: csLastSendStatusPending');
  });
});

describe('previous-transfer banner', () => {
  const remember = (minutesAgo: number) => localStorage.setItem(LAST_SEND_STORAGE_KEY, JSON.stringify({
    coin: 'SOL', hash: '5solSig', at: Date.now() - minutesAgo * 60_000, amount: '0.01', to: '9WzD…AWWM',
  }));

  it('shows a recent transfer with its live status and explorer link; ✕ forgets it', async () => {
    remember(5);
    const view = render(<CryptoSendScreen initialCoin="TRX" initialAddress="" initialAmount="" />);
    const banner = await screen.findByTestId('last-send-banner');
    expect(banner).toHaveTextContent('Prev: 0.01 SOL → 9WzD…AWWM. Status: csLastSendStatusPending');
    expect(lastHookArgs()).toMatchObject({ coin: 'SOL', hash: '5solSig', enabled: true });
    expect(screen.getByText('csViewOnSolscan').closest('a')).toHaveAttribute('href', 'https://solscan.io/tx/5solSig');

    H.status = { state: 'confirmed', polling: false, timedOut: false };
    view.rerender(<CryptoSendScreen initialCoin="TRX" initialAddress="" initialAmount="" />);
    expect(await screen.findByTestId('last-send-banner')).toHaveTextContent('Status: csLastSendStatusConfirmed');

    fireEvent.click(screen.getByLabelText('csLastSendDismiss'));
    expect(screen.queryByTestId('last-send-banner')).not.toBeInTheDocument();
    expect(localStorage.getItem(LAST_SEND_STORAGE_KEY)).toBeNull();
  });

  it('no banner for a record older than 30 minutes', async () => {
    remember(31);
    render(<CryptoSendScreen initialCoin="TRX" initialAddress="" initialAmount="" />);
    await screen.findByText('csContinue');
    expect(screen.queryByTestId('last-send-banner')).not.toBeInTheDocument();
    expect(localStorage.getItem(LAST_SEND_STORAGE_KEY)).toBeNull();
  });

  it('no banner and no polling in demo mode', async () => {
    remember(1);
    H.auth = { user: null as unknown as { id: string }, isDemo: true, isLoading: false };
    render(<CryptoSendScreen initialCoin="TRX" initialAddress="" initialAmount="" />);
    await screen.findByText('csContinue');
    expect(screen.queryByTestId('last-send-banner')).not.toBeInTheDocument();
    expect(H.useTxStatus.mock.calls.every((c) => c[0].enabled === false)).toBe(true);
  });
});

describe('fresh balances after a send', () => {
  it('"New transaction" drops the shared cache; Continue waits for a fresh balance round', async () => {
    await sendThrough();
    await screen.findByText('csSent');
    const callsBefore = H.fetchRealBalances.mock.calls.length;

    let finishBalances: (b: typeof BALANCES) => void = () => {};
    H.fetchRealBalances.mockImplementationOnce(() => new Promise((resolve) => { finishBalances = resolve; }));
    fireEvent.click(screen.getByText('csNewTransaction'));

    expect(H.resetSharedBalances).toHaveBeenCalledTimes(1);
    expect(H.fetchRealBalances.mock.calls.length).toBe(callsBefore + 1);
    // The transfer just sent is shown on the form with its status.
    expect(await screen.findByTestId('last-send-banner')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('T…'), { target: { value: TRON_TO } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } });
    const cont = screen.getByText('csContinue');
    expect(cont).toBeDisabled();
    expect(screen.getByText('csLoadingEllipsis')).toBeInTheDocument();

    await act(async () => { finishBalances({ ...BALANCES, trx: 99 }); });
    await waitFor(() => expect(cont).not.toBeDisabled());
  });
});
