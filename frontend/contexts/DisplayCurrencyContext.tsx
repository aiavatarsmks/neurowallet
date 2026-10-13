import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getCachedUsdPerEur, PRICES_UPDATED_EVENT } from '@/lib/crypto/balances';

export type DisplayCurrency = 'EUR' | 'USD';

const STORAGE_KEY = 'nw_display_currency';
/** Used only until the price feed has supplied a live rate (CoinGecko bitcoin.usd / bitcoin.eur). */
export const FALLBACK_USD_PER_EUR = 1.08;

interface DisplayCurrencyContextValue {
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
  symbol: '€' | '$';
  formatFiat: (eurValue: number, options?: Intl.NumberFormatOptions) => string;
  convertFromEur: (eurValue: number) => number;
}

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | undefined>(undefined);

function initialCurrency(): DisplayCurrency {
  if (typeof window === 'undefined') return 'EUR';
  try {
    return localStorage.getItem(STORAGE_KEY) === 'USD' ? 'USD' : 'EUR';
  } catch {
    return 'EUR';
  }
}

export const DisplayCurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('EUR');
  const [usdPerEur, setUsdPerEur] = useState<number | null>(null);

  useEffect(() => {
    setCurrencyState(initialCurrency());
  }, []);

  // Live EUR→USD rate: read the price cache now and whenever balances.ts caches fresh prices.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const read = () => setUsdPerEur(getCachedUsdPerEur());
    read();
    window.addEventListener(PRICES_UPDATED_EVENT, read);
    return () => window.removeEventListener(PRICES_UPDATED_EVENT, read);
  }, []);

  const setCurrency = useCallback((next: DisplayCurrency) => {
    setCurrencyState(next);
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* private mode: the choice just isn't remembered */ }
  }, []);

  const value = useMemo<DisplayCurrencyContextValue>(() => {
    const symbol = currency === 'USD' ? '$' : '€';
    const rate = usdPerEur ?? FALLBACK_USD_PER_EUR;
    const convertFromEur = (eurValue: number) => currency === 'USD' ? eurValue * rate : eurValue;
    const formatFiat = (eurValue: number, options: Intl.NumberFormatOptions = {}) => {
      const formatted = convertFromEur(eurValue).toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...options,
      });
      return `${symbol}${formatted}`;
    };
    return { currency, setCurrency, symbol, formatFiat, convertFromEur };
  }, [currency, setCurrency, usdPerEur]);

  return (
    <DisplayCurrencyContext.Provider value={value}>
      {children}
    </DisplayCurrencyContext.Provider>
  );
};

export function useDisplayCurrency(): DisplayCurrencyContextValue {
  const ctx = useContext(DisplayCurrencyContext);
  if (!ctx) throw new Error('useDisplayCurrency must be used within DisplayCurrencyProvider');
  return ctx;
}
