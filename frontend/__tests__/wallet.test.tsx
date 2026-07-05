import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { BalanceCard } from '../components/BalanceCard';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isDemo: false }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => ({
      greetingMorning: 'Доброе утро',
      greetingDay: 'Добрый день',
      greetingEvening: 'Добрый вечер',
      viewTotal: 'Всего',
      viewFiat: 'Фиат',
      viewCrypto: 'Крипто',
      labelTotalBalance: 'Общий баланс',
      labelCryptoPortfolio: 'Крипто-портфель',
      loadingText: 'Загружаем...',
      fiatComingSoon: 'Фиат-счёт — скоро',
      noWalletYet: 'Создайте кошелёк, чтобы увидеть баланс',
    }[key] ?? key),
  }),
}));

vi.mock('@/contexts/DisplayCurrencyContext', () => ({
  useDisplayCurrency: () => ({
    currency: 'EUR',
    setCurrency: vi.fn(),
    symbol: '€',
    convertFromEur: (value: number) => value,
    formatFiat: (value: number) => `€${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  }),
}));

describe('BalanceCard component', () => {
  it('renders a balance label', () => {
    render(<BalanceCard />);
    const heading = screen.getByText(/Крипто-портфель/i);
    expect(heading).toBeInTheDocument();
  });
});
