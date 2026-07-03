/**
 * Regression: fresh import → redirect to /wallet crashed with React #300
 * ("Rendered fewer hooks than during the previous render").
 *
 * Root cause: a useEffect was declared AFTER the early returns in
 * pages/wallet.tsx. On a fresh import the wallet exists AND a PIN was just
 * set, so the mount effect flips pinRequired false→true; the second render
 * then takes the PIN-gate early return and calls one fewer hook than the
 * first render → invariant #300.
 *
 * This test drives exactly that state (wallet_eth_address + wallet_pin_blob
 * present, authenticated, not demo) and asserts the page renders the PIN gate
 * instead of throwing. Child components are stubbed to isolate WalletPage's
 * own hook ordering.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const replace = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ replace, push: vi.fn(), query: {}, isReady: true }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isDemo: false, isLoading: false }),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));
// next/dynamic (NeuraAvatar) → trivial stub
vi.mock('next/dynamic', () => ({ default: () => () => null }));
// Break the supabase env-var import chain (irrelevant to hook ordering).
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {}, from: () => ({}) } }));

// Stub every heavy child so only WalletPage's hook logic is under test.
vi.mock('@/components/PinEntry', () => ({ PinEntry: () => <div data-testid="pin-entry" /> }));
vi.mock('@/components/BalanceCard', () => ({ BalanceCard: () => null }));
vi.mock('@/components/DemoGuide', () => ({ DemoGuide: () => null }));
vi.mock('@/components/TxHistory', () => ({ TxHistory: () => null }));
vi.mock('@/components/TransferButton', () => ({ TransferButton: () => null }));
vi.mock('@/components/BottomNav', () => ({ BottomNav: () => null }));
vi.mock('@/components/MiniChart', () => ({ MiniChart: () => null }));
vi.mock('@/components/SendScreen', () => ({ SendScreen: () => null }));
vi.mock('@/components/NeuraChat', () => ({ NeuraChat: () => null }));
vi.mock('@/components/ProfileScreen', () => ({ ProfileScreen: () => null }));
vi.mock('@/components/CardsScreen', () => ({ CardsScreen: () => null }));
vi.mock('@/components/WalletScreen', () => ({ WalletScreen: () => null }));
vi.mock('@/components/ReceiveScreen', () => ({ ReceiveScreen: () => null }));
vi.mock('@/components/CryptoSendScreen', () => ({ CryptoSendScreen: () => null }));

import WalletPage from '@/pages/wallet';

describe('WalletPage — fresh import → /wallet (React #300 regression)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Fresh-import state: wallet present AND a PIN just set. hasPinSetup()
    // reads wallet_pin_blob; the mount effect then flips pinRequired→true.
    localStorage.setItem('wallet_eth_address', '0xabc');
    localStorage.setItem('wallet_pin_blob', 'dummy-blob');
  });

  it('renders the PIN gate without a hook-order crash', () => {
    expect(() => render(<WalletPage />)).not.toThrow();
    expect(screen.getByTestId('pin-entry')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled(); // no redirect: wallet present
  });
});
