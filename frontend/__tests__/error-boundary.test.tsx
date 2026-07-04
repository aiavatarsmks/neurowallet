/**
 * ErrorBoundary: a render throw must become a recoverable screen (not a white
 * screen), surface the error text, and offer a safe reset that clears wallet +
 * PIN localStorage without touching unrelated keys.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('kaboom-xyz');
}

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

  it('catches a render throw and shows the recoverable fallback with the error text', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText(/Что-то пошло не так/)).toBeInTheDocument();
    expect(screen.getByText(/kaboom-xyz/)).toBeInTheDocument();
    expect(screen.getByText(/Перезагрузить/)).toBeInTheDocument();
  });

  it('safe reset clears wallet + PIN keys but preserves unrelated ones', () => {
    localStorage.setItem('wallet_keystore', 'ks');
    localStorage.setItem('wallet_sol_enc', 'blob');
    localStorage.setItem('wallet_pin_blob', 'pin');
    localStorage.setItem('wallet_language', 'ru'); // not a key blob — must survive

    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    fireEvent.click(screen.getByText(/Сбросить и переимпортировать/));

    expect(localStorage.getItem('wallet_keystore')).toBeNull();
    expect(localStorage.getItem('wallet_sol_enc')).toBeNull();
    expect(localStorage.getItem('wallet_pin_blob')).toBeNull();
    expect(localStorage.getItem('wallet_language')).toBe('ru');
  });
});
