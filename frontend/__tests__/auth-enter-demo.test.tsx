/**
 * AuthContext.enterDemo (reachable from the PIN screen) ends the Supabase
 * session on THIS device only: signOut({ scope: 'local' }). The default
 * 'global' scope revoked the user's sessions on every device.
 * The regular signOut() is unchanged.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  signOut: vi.fn(async (_opts?: unknown) => ({ error: null })),
  track: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: H.signOut,
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      setSession: vi.fn(),
    },
  },
}));
vi.mock('@/lib/analytics', () => ({ track: H.track }));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

function Probe() {
  const { enterDemo, signOut, isDemo } = useAuth();
  return (
    <>
      <button onClick={enterDemo}>demo</button>
      <button onClick={signOut}>sign-out</button>
      <span data-testid="is-demo">{String(isDemo)}</span>
    </>
  );
}

describe('AuthContext demo entry', () => {
  beforeEach(() => {
    localStorage.clear();
    H.signOut.mockClear();
    H.track.mockClear();
  });

  it('enterDemo signs out with local scope only and enters demo', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByText('demo'));
    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await waitFor(() => expect(screen.getByTestId('is-demo')).toHaveTextContent('true'));
    expect(localStorage.getItem('nw_demo')).toBe('true');
    expect(H.track).toHaveBeenCalledWith('demo_entered');
  });

  it('the regular sign-out keeps its previous call', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByText('sign-out'));
    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut.mock.calls[0]).toEqual([]);
  });
});
