import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type DisplayCurrency = 'EUR' | 'USD';

const STORAGE_KEY = 'nw_display_currency';
const EUR_TO_USD = 1.08;

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
  return localStorage.getItem(STORAGE_KEY) === 'USD' ? 'USD' : 'EUR';
}

export const DisplayCurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('EUR');

  useEffect(() => {
    setCurrencyState(initialCurrency());
  }, []);

  const setCurrency = useCallback((next: DisplayCurrency) => {
    setCurrencyState(next);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<DisplayCurrencyContextValue>(() => {
    const symbol = currency === 'USD' ? '$' : '€';
    const convertFromEur = (eurValue: number) => currency === 'USD' ? eurValue * EUR_TO_USD : eurValue;
    const formatFiat = (eurValue: number, options: Intl.NumberFormatOptions = {}) => {
      const formatted = convertFromEur(eurValue).toLocaleString('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...options,
      });
      return `${symbol}${formatted}`;
    };
    return { currency, setCurrency, symbol, formatFiat, convertFromEur };
  }, [currency, setCurrency]);

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
