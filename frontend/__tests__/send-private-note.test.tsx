/**
 * SendScreen "note": for crypto it is never sent on-chain (no memo support),
 * so it must be labelled as a private note; fiat keeps the plain label.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({ onSend: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isDemo: true, isLoading: false }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'en' }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('@/lib/demo-guide', () => ({ completeDemoTask: vi.fn() }));
vi.mock('@/components/ClaimCreate', () => ({ ClaimCreate: () => null }));
vi.mock('@/lib/claim-config', () => ({ claimLinksEnabled: () => false }));

import { SendScreen } from '@/components/SendScreen';

describe('SendScreen note field', () => {
  beforeEach(() => {
    localStorage.clear();
    H.onSend.mockReset();
  });

  it('crypto recipient: private note placeholder and confirm label; the note is not in the send draft', async () => {
    localStorage.setItem('nw_recipients_v1', JSON.stringify([
      { id: 'c1', name: 'Bob Crypto', initials: 'BC', trusted: true, currency: 'TRC20', address: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' },
    ]));
    render(<SendScreen onSendCryptoTransfer={H.onSend} />);
    fireEvent.click(await screen.findByText('Bob Crypto'));
    const note = await screen.findByPlaceholderText('sendPrivateNotePlaceholder', {}, { timeout: 2000 });
    expect(screen.queryByPlaceholderText('sendNotePlaceholder')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '5' } });
    fireEvent.change(note, { target: { value: 'rent october' } });
    fireEvent.click(screen.getByText('sendContinue'));
    expect(await screen.findByText('sendPrivateNoteLabel')).toBeInTheDocument();
    expect(screen.getByText('rent october')).toBeInTheDocument();

    fireEvent.click(screen.getByText('sendProceedToSign'));
    expect(H.onSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(H.onSend.mock.calls[0][0])).not.toContain('rent october');
  });

  it('fiat recipient keeps the plain note label', async () => {
    render(<SendScreen onSendCryptoTransfer={H.onSend} />);
    fireEvent.click(await screen.findByText('John Doe'));
    expect(await screen.findByPlaceholderText('sendNotePlaceholder', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('sendPrivateNotePlaceholder')).not.toBeInTheDocument();
  });
});
