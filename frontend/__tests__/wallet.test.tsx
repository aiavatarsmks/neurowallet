import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BalanceCard } from '../components/BalanceCard';

describe('BalanceCard component', () => {
  it('renders a balance label', () => {
    render(<BalanceCard />);
    const heading = screen.getByText(/Balance/i);
    expect(heading).toBeInTheDocument();
  });
});