/**
 * TxHistory: "couldn't load" (401 / 429 / 500 / offline / no session) must not
 * look like "no transactions", and Retry reloads.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({ session: { access_token: 'jwt' } as { access_token: string } | null }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isDemo: false, isLoading: false }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'en' }) }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: H.session } }) } },
}));
vi.mock('@/lib/neura/explain-client', () => ({ fetchExplanation: vi.fn() }));

import { TxHistory } from '@/components/TxHistory';

const TX = {
  id: 't1', chain: 'TRC20', type: 'in', amount: 1234.5, address: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
  hash: 'ab'.repeat(32), date: '2026-01-02T10:00:00Z', fee: 0,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('TxHistory load states', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wallet_eth_address', '0x' + '1'.repeat(40));
    H.session = { access_token: 'jwt' };
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const status of [401, 429, 500]) {
    it(`HTTP ${status} → error state with Retry, not "No transactions"`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'x' }, status)));
      render(<TxHistory />);
      expect(await screen.findByText('txLoadFailed')).toBeInTheDocument();
      expect(screen.getByText('txRetry')).toBeInTheDocument();
      expect(screen.queryByText('txNoTransactions')).not.toBeInTheDocument();
    });
  }

  it('network error and missing session are errors too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const { unmount } = render(<TxHistory />);
    expect(await screen.findByText('txLoadFailed')).toBeInTheDocument();
    unmount();

    H.session = null;
    render(<TxHistory />);
    expect(await screen.findByText('txLoadFailed')).toBeInTheDocument();
  });

  it('an empty list is "No transactions"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ transactions: [] })));
    render(<TxHistory />);
    expect(await screen.findByText('txNoTransactions')).toBeInTheDocument();
    expect(screen.queryByText('txLoadFailed')).not.toBeInTheDocument();
  });

  it('Retry reloads and shows the list; amounts use the UI locale', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ error: 'Rate limit exceeded' }, 429))
      .mockResolvedValueOnce(json({ transactions: [TX] }));
    vi.stubGlobal('fetch', f);
    render(<TxHistory />);
    fireEvent.click(await screen.findByText('txRetry'));
    expect(await screen.findByText(/1,234\.5/)).toBeInTheDocument(); // en-US, not ru-RU "1 234,5"
    expect(f).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('txLoadFailed')).not.toBeInTheDocument();
  });
});
