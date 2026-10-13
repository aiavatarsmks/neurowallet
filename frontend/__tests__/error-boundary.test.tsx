/**
 * ErrorBoundary: a render throw must become a recoverable screen (not a white
 * screen) and surface the error text. "Reload" is the primary action. The
 * reset that removes the keys sits behind a two-step confirmation, snapshots
 * the wallet entries to nw_wallet_backup_v1 first, and leaves unrelated keys.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { translations } from '@/lib/i18n';

function Boom(): React.ReactElement {
  throw new Error('kaboom-xyz');
}

const RU = translations.ru;
const EN = translations.en;

describe('ErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // React logs the caught error + jsdom logs the reset navigation; silence both.
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
  });
  afterEach(() => errSpy.mockRestore());

  it('renders children when there is no error', () => {
    render(<ErrorBoundary><div data-testid="ok">fine</div></ErrorBoundary>);
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('catches a render throw and shows the fallback with the error text (RU)', () => {
    localStorage.setItem('wallet_language', 'ru');
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(RU.ebTitle)).toBeInTheDocument();
    expect(screen.getByText(/kaboom-xyz/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RU.ebReload })).toBeInTheDocument();
  });

  it('uses English copy for an English user and drops the misleading "seed phrase is safe" claim', () => {
    localStorage.setItem('wallet_language', 'en');
    const { container } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(EN.ebTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN.ebReload })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/seed phrase is safe/i);
  });

  it('Reload comes before the reset action', () => {
    localStorage.setItem('wallet_language', 'ru');
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons[0]).toBe(RU.ebReload);
    expect(buttons[1]).toBe(RU.ebResetCta);
  });

  it('first tap only asks; Cancel keeps every key', () => {
    localStorage.setItem('wallet_language', 'ru');
    localStorage.setItem('wallet_keystore', 'ks');
    localStorage.setItem('wallet_eth_address', '0xabc');

    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: RU.ebResetCta }));

    expect(screen.getByTestId('eb-reset-confirm')).toBeInTheDocument();
    expect(screen.getByText(RU.keysDeleteWarn)).toBeInTheDocument();
    expect(localStorage.getItem('wallet_keystore')).toBe('ks');

    fireEvent.click(screen.getByRole('button', { name: RU.keysDeleteCancel }));
    expect(screen.queryByTestId('eb-reset-confirm')).not.toBeInTheDocument();
    expect(localStorage.getItem('wallet_keystore')).toBe('ks');
    expect(localStorage.getItem('wallet_eth_address')).toBe('0xabc');
  });

  it('confirmed reset backs up, then clears wallet + PIN keys and preserves unrelated ones', () => {
    localStorage.setItem('wallet_keystore', 'ks');
    localStorage.setItem('wallet_eth_address', '0xabc');
    localStorage.setItem('wallet_sol_enc', 'blob');
    localStorage.setItem('wallet_pin_blob', 'pin');
    localStorage.setItem('wallet_language', 'ru'); // not a key blob — must survive

    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: RU.ebResetCta }));
    fireEvent.click(screen.getByRole('button', { name: RU.keysDeleteConfirm }));

    expect(localStorage.getItem('wallet_keystore')).toBeNull();
    expect(localStorage.getItem('wallet_sol_enc')).toBeNull();
    expect(localStorage.getItem('wallet_pin_blob')).toBeNull();
    expect(localStorage.getItem('wallet_language')).toBe('ru');

    const backup = JSON.parse(localStorage.getItem('nw_wallet_backup_v1')!);
    expect(backup.keys).toEqual({ wallet_keystore: 'ks', wallet_eth_address: '0xabc', wallet_sol_enc: 'blob' });
    expect(typeof backup.at).toBe('string');
  });
});
