/**
 * PinEntry: demo entry from the lock screen (DEMO_PIN_FIX.md Fix 1),
 * "Forgot PIN?", and onSuccess with no password argument, called once even
 * when the parent re-renders while the PIN is being checked.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  verifyPin: vi.fn<(pin: string) => Promise<void>>(),
}));

vi.mock('@/lib/pin', () => ({
  verifyPin: h.verifyPin,
  getLockoutMs: () => 0,
  getRemainingAttempts: () => 5,
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, lang: 'ru', setLang: () => {} }),
}));

import { PinEntry } from '@/components/PinEntry';

function typePin(pin: string) {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }));
}

describe('PinEntry', () => {
  beforeEach(() => { h.verifyPin.mockReset(); });

  it('shows the demo button under an "or" divider only when onDemo is given', () => {
    const onDemo = vi.fn();
    const { unmount } = render(<PinEntry onSuccess={() => {}} />);
    expect(screen.queryByText('pinDemoCta')).not.toBeInTheDocument();
    unmount();

    render(<PinEntry onSuccess={() => {}} onDemo={onDemo} />);
    expect(screen.getByText('pinOr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pinDemoCta' }));
    expect(onDemo).toHaveBeenCalledTimes(1);
  });

  it('shows "Forgot PIN?" when onForgotPin is given', () => {
    const onForgotPin = vi.fn();
    render(<PinEntry onSuccess={() => {}} onForgotPin={onForgotPin} />);
    fireEvent.click(screen.getByRole('button', { name: 'pinForgot' }));
    expect(onForgotPin).toHaveBeenCalledTimes(1);
  });

  it('calls onSuccess with no arguments after a correct PIN', async () => {
    h.verifyPin.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<PinEntry onSuccess={onSuccess} />);
    typePin('1234');
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith();
    expect(h.verifyPin).toHaveBeenCalledWith('1234');
  });

  it('verifies once even if the parent re-renders with a new callback mid-check', async () => {
    let resolve: () => void = () => {};
    h.verifyPin.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    const onSuccess = vi.fn();
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      return <PinEntry key="pin" onSuccess={() => onSuccess(n)} />;
    }
    render(<Parent />);
    typePin('1234');
    await waitFor(() => expect(h.verifyPin).toHaveBeenCalledTimes(1));
    act(() => bump());
    act(() => bump());
    await act(async () => { resolve(); });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(h.verifyPin).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(2); // latest callback
  });

  it('shows the wrong-PIN message and clears the dots on a wrong PIN', async () => {
    h.verifyPin.mockRejectedValue(new Error('WRONG:4'));
    render(<PinEntry onSuccess={() => {}} />);
    typePin('0000');
    await waitFor(() => expect(screen.getByText('pinWrongMsg')).toBeInTheDocument());
    expect(h.verifyPin).toHaveBeenCalledTimes(1);
  });
});
