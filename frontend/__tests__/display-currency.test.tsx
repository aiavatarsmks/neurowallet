import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import { DisplayCurrencyProvider, useDisplayCurrency } from '@/contexts/DisplayCurrencyContext';
import { PRICES_UPDATED_EVENT } from '@/lib/crypto/balances';

const PRICE_CACHE = 'nw_prices_cache_v2';
const USDT_EUR = 0.86; // 1 USDT in EUR (CoinGecko tether.eur)

function cachePrices(usdPerEur: number | null) {
  localStorage.setItem(PRICE_CACHE, JSON.stringify({
    ethEur: 3000, solEur: 150, btcEur: 100_000, trxEur: 0.3, tonEur: 2.5, usdtEur: USDT_EUR,
    fetchedAt: Date.now(), priceUpdatedAt: Date.now(), usdPerEur,
  }));
}

function Probe() {
  const { formatFiat } = useDisplayCurrency();
  return <span data-testid="usdt">{formatFiat(USDT_EUR)}</span>;
}

const renderUsd = () => {
  localStorage.setItem('nw_display_currency', 'USD');
  return render(<DisplayCurrencyProvider><Probe /></DisplayCurrencyProvider>);
};

describe('DisplayCurrencyContext: live EUR→USD rate', () => {
  beforeEach(() => localStorage.clear());

  it('uses the live usdPerEur from the price cache: 1 USDT ≈ $1.00', () => {
    cachePrices(1.163);
    renderUsd();
    expect(screen.getByTestId('usdt')).toHaveTextContent('$1,00');
  });

  it('falls back to 1.08 when no live rate is cached', () => {
    cachePrices(null);
    renderUsd();
    expect(screen.getByTestId('usdt')).toHaveTextContent('$0,93'); // 0.86 × 1.08
  });

  it('picks up a new rate when fresh prices are cached', () => {
    renderUsd();
    expect(screen.getByTestId('usdt')).toHaveTextContent('$0,93');
    act(() => {
      cachePrices(1.163);
      window.dispatchEvent(new Event(PRICES_UPDATED_EVENT));
    });
    expect(screen.getByTestId('usdt')).toHaveTextContent('$1,00');
  });

  it('EUR mode is unaffected', () => {
    cachePrices(1.163);
    render(<DisplayCurrencyProvider><Probe /></DisplayCurrencyProvider>);
    expect(screen.getByTestId('usdt')).toHaveTextContent('€0,86');
  });
});
