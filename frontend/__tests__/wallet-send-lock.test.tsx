/**
 * pages/wallet.tsx while a transfer is in flight (lib/send-lock.ts): the
 * header Back, the settings toggle and the bottom nav are disabled, so the
 * send screen cannot be left mid-send; Telegram asks before closing the Mini
 * App. Everything comes back when the send ends. Heavy screens are stubbed;
 * BottomNav is the real component.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { user: null as unknown, isDemo: true, isLoading: false, enterDemo: vi.fn() },
  router: { replace: vi.fn(), push: vi.fn(), isReady: true, query: {} as Record<string, string> },
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
  hasPinSetup: () => true,
  verifyWalletPassword: vi.fn(async () => false),
  verifyPin: vi.fn(async () => {}),
  getLockoutMs: () => 0,
  getRemainingAttempts: () => 5,
  setupPin: vi.fn(async () => {}),
}));
vi.mock('@/components/PinSetup', () => ({ PinSetup: () => <div data-testid="pin-setup" /> }));
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/components/BalanceCard', () => ({ BalanceCard: () => <div data-testid="balance-card" /> }));
vi.mock('@/components/DemoGuide', () => ({ DemoGuide: () => <div data-testid="demo-guide" /> }));
vi.mock('@/components/TxHistory', () => ({ TxHistory: () => <div data-testid="tx-history" /> }));
vi.mock('@/components/TransferButton', () => ({ TransferButton: () => <div data-testid="transfer-button" /> }));
vi.mock('@/components/MiniChart', () => ({ MiniChart: () => <div data-testid="mini-chart" /> }));
vi.mock('@/components/SendScreen', () => ({ SendScreen: () => <div data-testid="send-screen" /> }));
vi.mock('@/components/NeuraChat', () => ({ NeuraChat: () => <div data-testid="neura-chat" /> }));
vi.mock('@/components/ProfileScreen', () => ({ ProfileScreen: () => <div data-testid="profile-screen" /> }));
vi.mock('@/components/CardsScreen', () => ({ CardsScreen: () => <div data-testid="cards-screen" /> }));
vi.mock('@/components/WalletScreen', () => ({
  WalletScreen: ({ onSendCrypto }: { onSendCrypto: (s: string) => void }) => (
    <button data-testid="wallet-screen" onClick={() => onSendCrypto('TRX')}>open-send</button>
  ),
}));
vi.mock('@/components/ReceiveScreen', () => ({ ReceiveScreen: () => <div data-testid="receive-screen" /> }));
vi.mock('@/components/CryptoSendScreen', () => ({ CryptoSendScreen: () => <div data-testid="crypto-send-screen" /> }));

import WalletPage from '@/pages/wallet';
import { sendLock, resetSendLockForTests } from '@/lib/send-lock';

const navButton = (label: string) =>
  (label === 'navNeura' ? screen.getByLabelText('navNeura') : screen.getByText(label).closest('button')) as HTMLButtonElement;

describe('wallet shell while a send is in flight', () => {
  const tg = {
    isVersionAtLeast: vi.fn(() => true),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
  };

  beforeEach(() => {
    resetSendLockForTests();
    localStorage.clear();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    tg.enableClosingConfirmation.mockReset();
    tg.disableClosingConfirmation.mockReset();
    (window as unknown as { Telegram?: unknown }).Telegram = { WebApp: tg };
  });
  afterEach(() => {
    resetSendLockForTests();
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  async function openSendScreen() {
    render(<WalletPage />);
    await screen.findByTestId('balance-card');
    fireEvent.click(navButton('navWallet'));
    fireEvent.click(await screen.findByTestId('wallet-screen'));
    await screen.findByTestId('crypto-send-screen');
  }

  it('disables Back, settings and the bottom nav; taps do not leave the send screen', async () => {
    await openSendScreen();
    act(() => { sendLock.acquire(); });

    const back = screen.getByLabelText('ariaBack');
    const settings = screen.getByLabelText('ariaProfile');
    expect(back).toBeDisabled();
    expect(settings).toBeDisabled();
    for (const label of ['navHome', 'navSend', 'navNeura', 'navCards', 'navWallet']) {
      expect(navButton(label)).toBeDisabled();
    }
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(back);
    fireEvent.click(settings);
    fireEvent.click(navButton('navHome'));
    fireEvent.click(navButton('navNeura'));
    expect(screen.getByTestId('crypto-send-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('balance-card')).not.toBeInTheDocument();
  });

  it('asks Telegram to confirm closing while locked, and lets go when the send ends', async () => {
    await openSendScreen();
    expect(tg.enableClosingConfirmation).not.toHaveBeenCalled();

    act(() => { sendLock.acquire(); });
    expect(tg.enableClosingConfirmation).toHaveBeenCalledTimes(1);

    act(() => { sendLock.release(); });
    expect(tg.disableClosingConfirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('ariaBack')).not.toBeDisabled();
    expect(navButton('navHome')).not.toBeDisabled();
    expect(screen.getByRole('navigation')).not.toHaveAttribute('aria-disabled');

    fireEvent.click(screen.getByLabelText('ariaBack'));
    expect(await screen.findByTestId('balance-card')).toBeInTheDocument();
  });
});
