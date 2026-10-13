import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translations } from '@/lib/i18n';
import type { WalletBalances } from '@/lib/crypto/balances';

const auth = vi.hoisted(() => ({ isDemo: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isDemo: auth.isDemo }) }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'ru', t: (k: keyof typeof translations.ru) => translations.ru[k] ?? k }),
}));
vi.mock('@/contexts/DisplayCurrencyContext', () => ({
  useDisplayCurrency: () => ({
    currency: 'EUR', setCurrency: vi.fn(), symbol: '€', convertFromEur: (v: number) => v,
    formatFiat: (v: number) => `€${v.toFixed(2)}`,
  }),
}));

const fetchRealBalances = vi.hoisted(() => vi.fn<() => Promise<WalletBalances>>());
vi.mock('@/lib/crypto/balances', async (orig) => ({
  ...(await orig<typeof import('@/lib/crypto/balances')>()),
  fetchRealBalances,
}));

import { BalanceCard } from '@/components/BalanceCard';
import { WalletScreen } from '@/components/WalletScreen';

const BASE: WalletBalances = {
  eth: 1, usdt: 0, usdtTrc: 0, trx: 0, usdtTon: 0, sol: 0, btc: 0.5, ton: 0,
  ethEur: 3000, solEur: 150, btcEur: 100_000, trxEur: 0.3, tonEur: 2.5, usdtEur: 0.86,
  ethChange24h: 0, solChange24h: 0, btcChange24h: 0, trxChange24h: 0, tonChange24h: 0, priceUpdatedAt: 0,
  unavailable: [], pricesStale: false, btcPending: 0, usdPerEur: 1.16,
};

const noop = () => {};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('wallet_eth_address', '0x' + 'a'.repeat(40));
  auth.isDemo = false;
  fetchRealBalances.mockReset();
});

describe('BalanceCard: honest refresh line', () => {
  it('names the assets that failed to refresh', async () => {
    fetchRealBalances.mockResolvedValue({ ...BASE, unavailable: ['ETH', 'BTC'] });
    render(<BalanceCard />);
    expect(await screen.findByText('Не удалось обновить: ETH, BTC. Показаны последние данные.')).toBeInTheDocument();
  });

  it('prices-only staleness has its own wording', async () => {
    fetchRealBalances.mockResolvedValue({ ...BASE, pricesStale: true });
    render(<BalanceCard />);
    expect(await screen.findByText('Курсы не обновились, показаны последние известные')).toBeInTheDocument();
  });

  it('no line when everything is fresh', async () => {
    fetchRealBalances.mockResolvedValue(BASE);
    render(<BalanceCard />);
    await waitFor(() => expect(fetchRealBalances).toHaveBeenCalled());
    await screen.findByText('€53000.00');
    expect(screen.queryByText(/Не удалось обновить|Курсы не обновились/)).not.toBeInTheDocument();
  });
});

describe('WalletScreen', () => {
  it('real mode: no mock price chart, refresh line and BTC pending shown', async () => {
    fetchRealBalances.mockResolvedValue({ ...BASE, unavailable: ['USDT_TRC'], btcPending: 0.0012 });
    const { container } = render(<WalletScreen onSendCrypto={noop} onReceiveCrypto={noop} />);
    expect(await screen.findByText('Не удалось обновить: USDT TRC-20. Показаны последние данные.')).toBeInTheDocument();
    expect(screen.getByText('+0,0012 BTC ожидает подтверждения')).toBeInTheDocument();
    expect(container.querySelector('.h-12')).toBeNull();
  });

  it('demo mode keeps the decorative chart and shows no refresh line', () => {
    auth.isDemo = true;
    const { container } = render(<WalletScreen onSendCrypto={noop} onReceiveCrypto={noop} />);
    expect(container.querySelector('.h-12')).not.toBeNull();
    expect(screen.queryByText(/Не удалось обновить/)).not.toBeInTheDocument();
    expect(fetchRealBalances).not.toHaveBeenCalled();
  });
});
