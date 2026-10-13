/**
 * CryptoSendScreen after broadcast: on-chain status on the done screen,
 * analytics, the Telegram notice body, and demo mode (no polling, no chain).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({
  auth: { user: { id: 'u1' }, isDemo: false, isLoading: false },
  sendUsdtTrc20: vi.fn(),
  sendTon: vi.fn(),
  sendBtc: vi.fn(),
  track: vi.fn(),
  useTxStatus: vi.fn(),
  status: { state: 'pending', polling: true, timedOut: false } as Record<string, unknown>,
}));

const TRON_TO = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const TON_TO = 'UQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG3M-';
const TRON_TXID = 'ab'.repeat(32);
const BTC_TO = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => H.auth }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string) => (k === 'csStatusFailed' ? 'csStatusFailed[{reason}]' : k),
    lang: 'en',
  }),
}));
vi.mock('@/contexts/DisplayCurrencyContext', () => ({
  useDisplayCurrency: () => ({ formatFiat: (v: number) => `€${v.toFixed(2)}` }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-1' } } }) } },
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
  fetchRealBalances: vi.fn(async () => ({
    eth: 1, btc: 0.01, sol: 0, usdt: 0, trx: 100, usdtTrc: 50, ton: 10, usdtTon: 0,
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
    status: 'ok', feeNative: 14, feeCurrency: 'TRX', feeEur: 3, balanceAfter: 49, warnings: [], btcFeeRateSatVb: 17,
  })),
}));
vi.mock('@/lib/crypto/transactions', () => ({
  sendEth: vi.fn(), sendUsdt: vi.fn(), sendSol: vi.fn(), sendBtc: vi.fn(), sendTrx: vi.fn(), sendUsdtTon: vi.fn(),
  sendUsdtTrc20: H.sendUsdtTrc20,
  sendTon: H.sendTon,
  isValidEthAddress: () => false,
  isValidSolAddress: () => false,
  isValidBtcAddress: (a: string) => a === BTC_TO,
  isValidTonAddress: (a: string) => a === TON_TO,
  isValidTronAddress: (a: string) => a === TRON_TO,
}));
vi.mock('@/lib/crypto/btc-tx', () => ({
  sendBtc: H.sendBtc,
  btcErrorCode: (e: { code?: string } | null) => (e?.code?.startsWith('BTC_') ? e.code : null),
  BTC_MAX_FEE_RATE_SAT_VB: 500,
}));

import { CryptoSendScreen } from '@/components/CryptoSendScreen';

const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response('{}', { status: 200 }));

async function sendThrough(coin: 'TRC20' | 'TON' | 'BTC', to: string, amount: string) {
  const view = render(<CryptoSendScreen initialCoin={coin} initialAddress={to} initialAmount={amount} />);
  const cont = await screen.findByText('csContinue');
  await waitFor(() => expect(cont).not.toBeDisabled());
  fireEvent.click(cont);
  if (H.auth.isDemo) {
    fireEvent.click(await screen.findByText('csSendDemo'));
    return view;
  }
  const toPassword = await screen.findByText('csEnterPassword');
  await waitFor(() => expect(toPassword.closest('button')).not.toBeDisabled());
  fireEvent.click(toPassword);
  const input = await screen.findByPlaceholderText('csPasswordPlaceholder');
  fireEvent.change(input, { target: { value: 'pw' } });
  await act(async () => { fireEvent.click(screen.getByText('csConfirmAndSend')); });
  return view;
}

describe('CryptoSendScreen done screen: on-chain status', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wallet_eth_address', '0x' + '1'.repeat(40));
    localStorage.setItem('wallet_keystore', '{"fake":"keystore"}');
    localStorage.setItem('wallet_tron_enc', 'tron-enc-blob');
    localStorage.setItem('wallet_ton_enc', 'ton-enc-blob');
    localStorage.setItem('wallet_ton_address', 'EQmyTonWallet');
    H.auth = { user: { id: 'u1' }, isDemo: false, isLoading: false };
    H.sendUsdtTrc20.mockReset().mockResolvedValue(TRON_TXID);
    H.sendTon.mockReset().mockResolvedValue('ton:seqno:7');
    H.track.mockReset();
    H.status = { state: 'pending', polling: true, timedOut: false };
    H.useTxStatus.mockReset().mockImplementation(() => H.status);
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const lastHookArgs = () => H.useTxStatus.mock.calls[H.useTxStatus.mock.calls.length - 1][0];

  it('polls the broadcast hash and shows "waiting" right after broadcast', async () => {
    await sendThrough('TRC20', TRON_TO, '5');
    expect(await screen.findByText('csStatusPending')).toBeInTheDocument();
    expect(lastHookArgs()).toMatchObject({ coin: 'TRC20', hash: TRON_TXID, enabled: true });
    expect(H.track).toHaveBeenCalledWith('send_succeeded', { coin: 'TRC20' }, 'trace-1');
  });

  it('USDT TRC-20 OUT_OF_ENERGY: failed title, reason, TRX fee note, analytics', async () => {
    const view = await sendThrough('TRC20', TRON_TO, '5');
    await screen.findByText('csStatusPending');
    H.status = { state: 'failed', reason: 'OUT_OF_ENERGY', polling: false, timedOut: false };
    view.rerender(<CryptoSendScreen initialCoin="TRC20" initialAddress={TRON_TO} initialAmount="5" />);
    expect(await screen.findByText('csStatusFailedTitle')).toBeInTheDocument();
    expect(screen.getByText('csStatusFailed[csStatusReasonOutOfEnergy]')).toBeInTheDocument();
    expect(screen.getByText('csStatusTronFeeSpent')).toBeInTheDocument();
    expect(screen.getByText('csNeuraFailedOnchain')).toBeInTheDocument();
    expect(screen.queryByText('csSent')).not.toBeInTheDocument();
    expect(H.track).toHaveBeenCalledWith('send_failed_onchain', { coin: 'TRC20' }, 'trace-1');
    expect(H.track.mock.calls.filter((c) => c[0] === 'send_failed_onchain')).toHaveLength(1);
  });

  it('TON: seqno reference + own wallet, honest "processed by the network" wording', async () => {
    H.status = { state: 'confirmed', polling: false, timedOut: false };
    await sendThrough('TON', TON_TO, '1.5');
    expect(await screen.findByText('csStatusProcessed')).toBeInTheDocument();
    expect(screen.queryByText('csStatusConfirmed')).not.toBeInTheDocument();
    expect(lastHookArgs()).toMatchObject({ coin: 'TON', hash: 'ton:seqno:7', enabled: true, tonWalletAddress: 'EQmyTonWallet' });
    expect(H.track).toHaveBeenCalledWith('send_confirmed', { coin: 'TON' }, 'trace-1');
  });

  it('Telegram notice uses the structured contract with the typed amount', async () => {
    localStorage.setItem('tg_user_id', '12345');
    // 0.0000001 is 1e-7 as a JS number: the server would reject String(number).
    await sendThrough('TON', TON_TO, '0.0000001');
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/tg-notify')).toBe(true));
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/tg-notify')!;
    const init = call[1] as RequestInit & { headers: Record<string, string> };
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'tx_sent', coin: 'TON', amount: '0.0000001', to: TON_TO, hash: 'ton:seqno:7', lang: 'en',
    });
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
  });

  it('a failing Telegram notice never turns a broadcast into send_failed', async () => {
    localStorage.setItem('tg_user_id', '12345');
    fetchMock.mockImplementation(async (url: unknown) => {
      if (url === '/api/tg-notify') throw new TypeError('offline');
      return new Response('{}', { status: 200 });
    });
    await sendThrough('TRC20', TRON_TO, '5');
    expect(await screen.findByText('csStatusPending')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(H.track.mock.calls.some((c) => c[0] === 'send_failed')).toBe(false);
  });

  it('BTC signs at the fee rate shown on the review', async () => {
    localStorage.setItem('wallet_btc_enc', 'btc-enc-blob');
    localStorage.setItem('wallet_btc_address', 'bc1qmine');
    H.sendBtc.mockReset().mockResolvedValue('cd'.repeat(32));
    await sendThrough('BTC', BTC_TO, '0.001');
    expect(H.sendBtc).toHaveBeenCalledTimes(1);
    expect(H.sendBtc.mock.calls[0]).toEqual(['btc-enc-blob', 'pw', BTC_TO, 0.001, 'bc1qmine', { feeRateSatVb: 17 }]);
  });

  it('BTC cap refusal is shown as translated text, not the raw lib message', async () => {
    localStorage.setItem('wallet_btc_enc', 'btc-enc-blob');
    localStorage.setItem('wallet_btc_address', 'bc1qmine');
    H.sendBtc.mockReset().mockRejectedValue(Object.assign(new Error('BTC fee rate 900 sat/vB is above the 500 sat/vB cap.'), { code: 'BTC_FEE_RATE_TOO_HIGH' }));
    await sendThrough('BTC', BTC_TO, '0.001');
    expect(await screen.findByText('csErrBtcFeeRateTooHigh')).toBeInTheDocument();
    expect(H.track).toHaveBeenCalledWith('send_failed', { coin: 'BTC' }, 'trace-1');
  });

  it('TON / USDT-TON forms warn that memo is not supported; other coins do not', async () => {
    const view = render(<CryptoSendScreen initialCoin="TON" initialAddress="" initialAmount="" />);
    expect(await screen.findByText('csTonMemoWarning')).toBeInTheDocument();
    view.rerender(<CryptoSendScreen initialCoin="USDT_TON" initialAddress="" initialAmount="" />);
    expect(await screen.findByText('csTonMemoWarning')).toBeInTheDocument();
    view.rerender(<CryptoSendScreen initialCoin="TRC20" initialAddress="" initialAmount="" />);
    await waitFor(() => expect(screen.queryByText('csTonMemoWarning')).not.toBeInTheDocument());
  });

  it('demo mode: no polling at all, demo text, no chain call', async () => {
    H.auth = { user: null as unknown as { id: string }, isDemo: true, isLoading: false };
    await sendThrough('TRC20', TRON_TO, '5');
    expect(await screen.findByText('csTxSentDemo')).toBeInTheDocument();
    expect(H.useTxStatus.mock.calls.every((c) => c[0].enabled === false)).toBe(true);
    expect(screen.queryByText('csStatusPending')).not.toBeInTheDocument();
    expect(H.sendUsdtTrc20).not.toHaveBeenCalled();
  });
});
