/**
 * pages/onboarding.tsx:
 *  - ?recover=1 with a wallet already on the device: a phrase for a DIFFERENT
 *    wallet needs an explicit confirmation, the SAME wallet proceeds silently,
 *    and the current wallet is snapshotted to nw_wallet_backup_v1 before the
 *    overwrite;
 *  - "Create new" with a wallet on the device asks first as well;
 *  - "Copy all" wipes the seed from the clipboard after 60 s, or right away
 *    when the page unmounts first.
 * Crypto is stubbed: derivation itself is covered by the crypto tests.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PHRASE_OTHER = 'one two three four five six seven eight nine ten eleven twelve';
const PHRASE_SAME = 'same same same same same same same same same same same same';

const h = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), isReady: true, query: { recover: '1' } as Record<string, string> },
  ethAddressFromMnemonic: vi.fn((phrase: string) => (phrase.startsWith('same') ? '0xAAA' : '0xBBB')),
  importWalletFromMnemonic: vi.fn(async (phrase: string) => ({
    eth: phrase.startsWith('same') ? '0xAAA' : '0xBBB',
    sol: 's', btc: 'b', tron: 't', ton: 'n', tonScheme: 'slip10-607-0-0',
    mnemonic: phrase, keystore: 'new-ks', solEnc: 'new-sol', btcEnc: 'new-btc', tronEnc: 'new-tron', tonEnc: 'new-ton',
  })),
  saveWalletToStorage: vi.fn((w: { eth: string; keystore: string }) => {
    localStorage.setItem('wallet_eth_address', w.eth);
    localStorage.setItem('wallet_keystore', w.keystore);
  }),
  generateNewWalletMnemonic: vi.fn(async () => 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'),
}));

vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isDemo: false, isLoading: false, enterDemo: vi.fn() }),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, lang: 'ru', setLang: () => {} }),
}));
vi.mock('@/lib/crypto/wallet', () => ({
  ethAddressFromMnemonic: h.ethAddressFromMnemonic,
  importWalletFromMnemonic: h.importWalletFromMnemonic,
  saveWalletToStorage: h.saveWalletToStorage,
  generateNewWalletMnemonic: h.generateNewWalletMnemonic,
}));
vi.mock('@/lib/ton-mnemonic-config', () => ({ tonMnemonicEnabled: () => false }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/claim-client', () => ({
  getPendingClaim: () => null, completeClaim: vi.fn(async () => {}), clearPendingClaim: vi.fn(),
}));
vi.mock('@/components/PinSetup', () => ({
  PinSetup: () => <div data-testid="pin-setup" />,
}));

import OnboardingWalletPage from '@/pages/onboarding';

function seedExistingWallet() {
  localStorage.setItem('wallet_eth_address', '0xAAA');
  localStorage.setItem('wallet_keystore', 'old-ks');
  localStorage.setItem('wallet_sol_enc', 'old-sol');
}

async function enterPhraseAndContinue(phrase: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: phrase } });
  fireEvent.click(screen.getByRole('button', { name: 'onbImportContinue' }));
}

async function setPasswordAndCreate() {
  const [pw, confirm] = screen.getAllByPlaceholderText(/Placeholder/);
  fireEvent.change(pw, { target: { value: 'secret-123' } });
  fireEvent.change(confirm, { target: { value: 'secret-123' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'onbCreateWallet' })); });
}

describe('onboarding ?recover=1 overwrite protection', () => {
  beforeEach(() => {
    localStorage.clear();
    h.router.query = { recover: '1' };
    h.router.push.mockReset();
    h.router.replace.mockReset();
    h.saveWalletToStorage.mockClear();
    h.importWalletFromMnemonic.mockClear();
    h.ethAddressFromMnemonic.mockClear();
  });
  afterEach(() => localStorage.clear());

  it('a phrase for a different wallet stops at a warning; Back changes nothing', async () => {
    seedExistingWallet();
    render(<OnboardingWalletPage />);
    await enterPhraseAndContinue(PHRASE_OTHER);

    expect(screen.getByTestId('confirm-replace')).toBeInTheDocument();
    expect(screen.getByText('onbReplaceImportWarn')).toBeInTheDocument();
    expect(screen.getByText('onbReplaceKeysWarn')).toBeInTheDocument();
    expect(screen.getByText('keysDeleteBackupNote')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'onbBack' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument(); // back on the phrase step
    expect(localStorage.getItem('wallet_keystore')).toBe('old-ks');
    expect(h.saveWalletToStorage).not.toHaveBeenCalled();
  });

  it('after explicit confirmation the old wallet is backed up, then replaced, and its PIN dropped', async () => {
    seedExistingWallet();
    localStorage.setItem('wallet_pin_blob', 'old-pin-blob');
    render(<OnboardingWalletPage />);
    await enterPhraseAndContinue(PHRASE_OTHER);
    fireEvent.click(screen.getByRole('button', { name: 'onbReplaceConfirm' }));
    await setPasswordAndCreate();

    expect(h.saveWalletToStorage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('wallet_eth_address')).toBe('0xBBB');
    const backup = JSON.parse(localStorage.getItem('nw_wallet_backup_v1')!);
    expect(backup.keys).toEqual({ wallet_eth_address: '0xAAA', wallet_keystore: 'old-ks', wallet_sol_enc: 'old-sol' });
    expect(localStorage.getItem('wallet_pin_blob')).toBeNull(); // stale PIN of the old wallet
    expect(screen.getByTestId('pin-setup')).toBeInTheDocument();
  });

  it('the same wallet proceeds silently to the password step', async () => {
    seedExistingWallet();
    render(<OnboardingWalletPage />);
    await enterPhraseAndContinue(PHRASE_SAME);
    expect(screen.queryByTestId('confirm-replace')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'onbCreateWallet' })).toBeInTheDocument();
  });

  it('no wallet on the device: no warning', async () => {
    render(<OnboardingWalletPage />);
    await enterPhraseAndContinue(PHRASE_OTHER);
    expect(screen.queryByTestId('confirm-replace')).not.toBeInTheDocument();
    expect(h.ethAddressFromMnemonic).not.toHaveBeenCalled();
  });

  it('"Create new" with a wallet on the device asks first', async () => {
    seedExistingWallet();
    render(<OnboardingWalletPage />);
    fireEvent.click(screen.getByRole('button', { name: 'onbBack' })); // import step → choice
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /onbCreateNewTitle/ })); });

    expect(screen.getByTestId('confirm-replace')).toBeInTheDocument();
    expect(screen.getByText('onbReplaceCreateWarn')).toBeInTheDocument();
    expect(h.generateNewWalletMnemonic).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'onbReplaceConfirm' })); });
    expect(h.generateNewWalletMnemonic).toHaveBeenCalledTimes(1);
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });
});

describe('onboarding seed copy', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    h.router.query = {};
    h.generateNewWalletMnemonic.mockClear();
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function showMnemonicAndCopy() {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /onbCreateNewTitle/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /onbCopyAll/ })); });
  }

  it('wipes the clipboard 60 s after "Copy all" and says so', async () => {
    render(<OnboardingWalletPage />);
    await showMnemonicAndCopy();

    expect(writeText).toHaveBeenCalledWith('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima');
    expect(screen.getByText('onbClipboardClears')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(59_000); });
    expect(writeText).not.toHaveBeenCalledWith('');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(writeText).toHaveBeenLastCalledWith('');
    expect(screen.queryByText('onbClipboardClears')).not.toBeInTheDocument();
  });

  it('leaving the page before 60 s wipes right away and cancels the timer', async () => {
    const { unmount } = render(<OnboardingWalletPage />);
    await showMnemonicAndCopy();
    writeText.mockClear();

    unmount();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
