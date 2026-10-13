/**
 * pages/wallet.tsx gates: PIN lock screen with demo entry and "Forgot PIN?"
 * (wallet password → new PIN), the two-step reset on the PIN-setup gate with
 * a backup first, MiniChart only in demo, and the static avatar for
 * prefers-reduced-motion. Heavy screens are stubbed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as unknown, isDemo: false, isLoading: false, enterDemo: vi.fn() },
  router: { replace: vi.fn(), push: vi.fn(), isReady: true, query: {} as Record<string, string> },
  hasPinSetup: vi.fn(() => true),
  verifyWalletPassword: vi.fn(async (_pw: string) => false),
  verifyPin: vi.fn(async (_pin: string) => {}),
}));

vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('next/dynamic', () => ({
  default: () => function DynamicStub() { return <div data-testid="neura-avatar-3d" />; },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, lang: 'ru', setLang: () => {} }),
}));
vi.mock('@/lib/pin', () => ({
  hasPinSetup: h.hasPinSetup,
  verifyWalletPassword: h.verifyWalletPassword,
  verifyPin: h.verifyPin,
  getLockoutMs: () => 0,
  getRemainingAttempts: () => 5,
  setupPin: vi.fn(async () => {}),
}));
vi.mock('@/components/PinSetup', () => ({
  PinSetup: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="pin-setup" onClick={onComplete}>set-new-pin</button>
  ),
}));
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/components/BalanceCard', () => ({ BalanceCard: () => <div data-testid="balance-card" /> }));
vi.mock('@/components/DemoGuide', () => ({ DemoGuide: () => <div data-testid="demo-guide" /> }));
vi.mock('@/components/TxHistory', () => ({ TxHistory: () => <div data-testid="tx-history" /> }));
vi.mock('@/components/TransferButton', () => ({ TransferButton: () => <div data-testid="transfer-button" /> }));
vi.mock('@/components/BottomNav', () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }));
vi.mock('@/components/MiniChart', () => ({ MiniChart: () => <div data-testid="mini-chart" /> }));
vi.mock('@/components/SendScreen', () => ({ SendScreen: () => <div data-testid="send-screen" /> }));
vi.mock('@/components/NeuraChat', () => ({ NeuraChat: () => <div data-testid="neura-chat" /> }));
vi.mock('@/components/ProfileScreen', () => ({ ProfileScreen: () => <div data-testid="profile-screen" /> }));
vi.mock('@/components/CardsScreen', () => ({ CardsScreen: () => <div data-testid="cards-screen" /> }));
vi.mock('@/components/WalletScreen', () => ({ WalletScreen: () => <div data-testid="wallet-screen" /> }));
vi.mock('@/components/ReceiveScreen', () => ({ ReceiveScreen: () => <div data-testid="receive-screen" /> }));
vi.mock('@/components/CryptoSendScreen', () => ({ CryptoSendScreen: () => <div data-testid="crypto-send-screen" /> }));

import WalletPage from '@/pages/wallet';

function setReducedMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: on && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('wallet page gates', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('wallet_eth_address', '0xabc');
    localStorage.setItem('wallet_keystore', 'ks');
    localStorage.setItem('wallet_sol_enc', 'sol-blob');
    h.auth.user = { id: 'u1' };
    h.auth.isDemo = false;
    h.auth.enterDemo.mockReset();
    h.router.push.mockReset();
    h.router.replace.mockReset();
    h.hasPinSetup.mockReturnValue(true);
    h.verifyWalletPassword.mockReset();
    h.verifyPin.mockReset();
    h.verifyPin.mockResolvedValue(undefined);
    setReducedMotion(false);
  });
  afterEach(() => localStorage.clear());

  it('locked wallet: PIN screen offers demo mode, which calls enterDemo', async () => {
    render(<WalletPage />);
    await screen.findByTestId('pin-entry');
    fireEvent.click(screen.getByRole('button', { name: 'pinDemoCta' }));
    expect(h.auth.enterDemo).toHaveBeenCalledTimes(1);
  });

  it('correct PIN unlocks the wallet; real users do not see the sample MiniChart', async () => {
    render(<WalletPage />);
    await screen.findByTestId('pin-entry');
    for (const d of '1234') fireEvent.click(screen.getByRole('button', { name: d }));
    await screen.findByTestId('balance-card');
    expect(h.verifyPin).toHaveBeenCalledWith('1234');
    expect(screen.queryByTestId('mini-chart')).not.toBeInTheDocument();
    expect(screen.getByTestId('neura-avatar-3d')).toBeInTheDocument();
  });

  it('demo mode shows the MiniChart', async () => {
    h.auth.isDemo = true;
    h.auth.user = null;
    render(<WalletPage />);
    await screen.findByTestId('balance-card');
    expect(screen.getByTestId('mini-chart')).toBeInTheDocument();
  });

  it('prefers-reduced-motion renders the static avatar instead of the 3D one', async () => {
    setReducedMotion(true);
    h.auth.isDemo = true;
    h.auth.user = null;
    render(<WalletPage />);
    await screen.findByTestId('neura-avatar-static');
    expect(screen.queryByTestId('neura-avatar-3d')).not.toBeInTheDocument();
  });

  it('Forgot PIN: wrong password is refused, right password leads to a new PIN and unlocks', async () => {
    render(<WalletPage />);
    await screen.findByTestId('pin-entry');
    fireEvent.click(screen.getByRole('button', { name: 'pinForgot' }));
    expect(screen.getByTestId('pin-reset')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('secPinPasswordPh');
    h.verifyWalletPassword.mockResolvedValueOnce(false);
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'pinResetCta' }));
    await screen.findByText('secPinWrongPassword');

    h.verifyWalletPassword.mockResolvedValueOnce(true);
    fireEvent.change(input, { target: { value: 'right-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'pinResetCta' }));
    fireEvent.click(await screen.findByTestId('pin-setup'));
    await screen.findByTestId('balance-card');
  });

  it('Forgot PIN: "forgot the password too" goes to seed recovery without deleting anything', async () => {
    render(<WalletPage />);
    await screen.findByTestId('pin-entry');
    fireEvent.click(screen.getByRole('button', { name: 'pinForgot' }));
    fireEvent.click(screen.getByRole('button', { name: 'pinResetRecoverCta' }));
    expect(h.router.push).toHaveBeenCalledWith('/onboarding?recover=1');
    expect(localStorage.getItem('wallet_keystore')).toBe('ks');
  });

  it('PIN-setup gate: reset asks first, then backs up and removes the keys', async () => {
    h.hasPinSetup.mockReturnValue(false);
    render(<WalletPage />);
    await screen.findByTestId('pin-setup-required');

    fireEvent.click(screen.getByRole('button', { name: 'pinSetupResetCta' }));
    expect(screen.getByTestId('reset-confirm')).toBeInTheDocument();
    expect(screen.getByText('keysDeleteWarn')).toBeInTheDocument();
    expect(localStorage.getItem('wallet_keystore')).toBe('ks');

    fireEvent.click(screen.getByRole('button', { name: 'keysDeleteCancel' }));
    expect(screen.queryByTestId('reset-confirm')).not.toBeInTheDocument();
    expect(localStorage.getItem('wallet_keystore')).toBe('ks');

    fireEvent.click(screen.getByRole('button', { name: 'pinSetupResetCta' }));
    fireEvent.click(screen.getByRole('button', { name: 'keysDeleteConfirm' }));
    await waitFor(() => expect(h.router.push).toHaveBeenCalledWith('/onboarding'));
    expect(localStorage.getItem('wallet_keystore')).toBeNull();
    expect(localStorage.getItem('wallet_eth_address')).toBeNull();
    const backup = JSON.parse(localStorage.getItem('nw_wallet_backup_v1')!);
    expect(backup.keys).toEqual({ wallet_eth_address: '0xabc', wallet_keystore: 'ks', wallet_sol_enc: 'sol-blob' });
  });
});
