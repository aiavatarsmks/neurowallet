import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { BalanceCard } from '../components/BalanceCard';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

describe('BalanceCard component', () => {
  it('renders a balance label', () => {
    render(<BalanceCard />);
    const heading = screen.getByText(/Общий капитал/i);
    expect(heading).toBeInTheDocument();
  });
});
