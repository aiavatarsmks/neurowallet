/**
 * pages/wallet.tsx PIN-gate tests.
 *
 * 1. React #300 regression: a useEffect declared after the early returns
 *    crashed the /wallet render right after a fresh import (the mount effect
 *    flips the gate, the second render takes the PIN-gate early return and
 *    calls one fewer hook). Fixed by hoisting the effect above the returns.
 *
 * 2. Fail-closed gate (security): the PIN gate must deny by default. Until the
 *    status is resolved from localStorage ('checking'), the loading placeholder
 *    is shown — NEVER wallet content. A locked wallet shows only the PIN entry.
 *    This guards against the observed "PIN не спросил, сразу пустил" race.
 *
 * Child components are stubbed to isolate WalletPage's own gate logic.
 * BottomNav renders only in the content branch, so it is our "content" marker.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null, isDemo: false, isLoading: false },
  replace: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ replace: H.replace, push: vi.fn(), query: {}, isReady: true }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => H.auth }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
// Break the supabase env-var import chain (irrelevant to gate logic).
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {}, from: () => ({}) } }));

// PinEntry + BottomNav get testids; BottomNav renders ONLY in the wallet
// content branch, so it marks "content is showing". Everything else is stubbed.
vi.mock('@/components/PinEntry', () => ({ PinEntry: () => <div data-testid="pin-entry" /> }));
vi.mock('@/components/PinSetup', () => ({ PinSetup: () => <div data-testid="pin-setup" /> }));
vi.mock('@/components/BottomNav', () => ({ BottomNav: () => <div data-testid="wallet-content" /> }));
vi.mock('@/components/BalanceCard', () => ({ BalanceCard: () => null }));
vi.mock('@/components/DemoGuide', () => ({ DemoGuide: () => null }));
vi.mock('@/components/TxHistory', () => ({ TxHistory: () => null }));
vi.mock('@/components/TransferButton', () => ({ TransferButton: () => null }));
vi.mock('@/components/MiniChart', () => ({ MiniChart: () => null }));
vi.mock('@/components/SendScreen', () => ({ SendScreen: () => null }));
vi.mock('@/components/NeuraChat', () => ({ NeuraChat: () => null }));
vi.mock('@/components/ProfileScreen', () => ({ ProfileScreen: () => null }));
vi.mock('@/components/CardsScreen', () => ({ CardsScreen: () => null }));
vi.mock('@/components/WalletScreen', () => ({ WalletScreen: () => null }));
vi.mock('@/components/ReceiveScreen', () => ({ ReceiveScreen: () => null }));
vi.mock('@/components/CryptoSendScreen', () => ({ CryptoSendScreen: () => null }));

import WalletPage from '@/pages/wallet';

describe('WalletPage PIN gate', () => {
  beforeEach(() => {
    localStorage.clear();
    H.auth = { user: { id: 'u1' }, isDemo: false, isLoading: false };
    H.replace.mockClear();
  });

  it('locked wallet shows the PIN gate, never wallet content (React #300 regression)', () => {
    // Fresh-import state: wallet present AND a PIN set → gate resolves 'locked'.
    localStorage.setItem('wallet_eth_address', '0xabc');
    localStorage.setItem('wallet_pin_blob', 'dummy-blob');

    expect(() => render(<WalletPage />)).not.toThrow(); // no #300
    expect(screen.getByTestId('pin-entry')).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-content')).not.toBeInTheDocument();
    expect(H.replace).not.toHaveBeenCalled();
  });

  it('fail-closed: unresolved PIN status never shows wallet content', () => {
    // Authed session but empty storage: the gate cannot resolve to 'open' — it
    // redirects to recovery and stays 'checking'. Deny-by-default means the
    // loading placeholder shows; neither wallet content nor a bypass.
    render(<WalletPage />);

    expect(screen.queryByTestId('wallet-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pin-entry')).not.toBeInTheDocument();
    expect(H.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('fail-closed: wallet without PIN forces PIN setup before content', () => {
    localStorage.setItem('wallet_eth_address', '0xabc');

    render(<WalletPage />);

    expect(screen.getByTestId('pin-setup-required')).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pin-entry')).not.toBeInTheDocument();
  });

  it('fail-closed: while auth is still loading, no wallet content leaks', () => {
    H.auth = { user: null, isDemo: false, isLoading: true };
    localStorage.setItem('wallet_eth_address', '0xabc');

    render(<WalletPage />);
    expect(screen.queryByTestId('wallet-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pin-entry')).not.toBeInTheDocument();
  });
});
