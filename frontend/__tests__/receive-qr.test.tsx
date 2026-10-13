/**
 * Receive QR codes: payment URI when an amount is requested, raw address text
 * stays visible / copyable; pay/[id] keeps the requested amount in its QR.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({
  toDataURL: vi.fn(async (_payload: string) => 'data:image/png;base64,AAAA'),
  query: { id: 'req-1' } as Record<string, string>,
}));

vi.mock('qrcode', () => ({ default: { toDataURL: H.toDataURL } }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), query: H.query }) }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isDemo: false, isLoading: false }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'en' }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { ReceiveScreen } from '@/components/ReceiveScreen';
import PayPage from '@/pages/pay/[id]';

const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const ETH = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const SOL = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const lastPayload = () => H.toDataURL.mock.calls[H.toDataURL.mock.calls.length - 1][0];

describe('ReceiveScreen QR', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wallet_eth_address', ETH);
    localStorage.setItem('wallet_btc_address', BTC);
    localStorage.setItem('wallet_sol_address', SOL);
    H.toDataURL.mockClear();
  });

  it('BTC: bitcoin: URI, amount added when requested; the visible address stays raw', async () => {
    render(<ReceiveScreen initialNetwork="BTC" />);
    await waitFor(() => expect(lastPayload()).toBe(`bitcoin:${BTC}`));
    fireEvent.change(screen.getByPlaceholderText('receiveRequestAmountPh'), { target: { value: '0,0015' } });
    await waitFor(() => expect(lastPayload()).toBe(`bitcoin:${BTC}?amount=0.0015`));
    expect(screen.getByText(BTC)).toBeInTheDocument();
  });

  it('ETH: raw address without amount, EIP 681 wei value with amount', async () => {
    render(<ReceiveScreen initialNetwork="ETH" />);
    await waitFor(() => expect(lastPayload()).toBe(ETH));
    fireEvent.change(screen.getByPlaceholderText('receiveRequestAmountPh'), { target: { value: '0.3' } });
    await waitFor(() => expect(lastPayload()).toBe(`ethereum:${ETH}@1?value=300000000000000000`));
  });

  it('USDT ERC-20: raw address even with an amount', async () => {
    render(<ReceiveScreen initialNetwork="USDT" />);
    fireEvent.change(await screen.findByPlaceholderText('receiveRequestAmountPh'), { target: { value: '25' } });
    await waitFor(() => expect(H.toDataURL).toHaveBeenCalled());
    expect(H.toDataURL.mock.calls.every((c) => c[0] === ETH)).toBe(true);
  });

  it('SOL shows the SPL note', async () => {
    render(<ReceiveScreen initialNetwork="SOL" />);
    expect(await screen.findByText('receiveSolSplNote')).toBeInTheDocument();
  });
});

describe('pay/[id] QR keeps the requested amount', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a tiny BTC amount (1.23e-6 as a JS number) is encoded as a plain decimal', async () => {
    H.toDataURL.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'req-1', status: 'active', coin: 'BTC', amount: 0.00000123, address: BTC,
    }))));
    render(<PayPage />);
    await waitFor(() => expect(lastPayload()).toBe(`bitcoin:${BTC}?amount=0.00000123`));
    expect(screen.getByText(BTC)).toBeInTheDocument();
  });

  it('request without amount: plain bitcoin: URI', async () => {
    H.toDataURL.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'req-1', status: 'active', coin: 'BTC', amount: null, address: BTC,
    }))));
    render(<PayPage />);
    await waitFor(() => expect(lastPayload()).toBe(`bitcoin:${BTC}`));
  });
});
