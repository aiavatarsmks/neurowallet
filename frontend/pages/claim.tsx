import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { claimLinksEnabled, parseClaimFromLocation } from '@/lib/claim-config';
import {
  fetchClaimStatus, completeClaim, savePendingClaim, clearPendingClaim, type ClaimStatusView,
} from '@/lib/claim-client';
import { track } from '@/lib/analytics';
import { coinLabel } from '@/lib/coin-labels';

/**
 * pages/claim.tsx — recipient landing for a claim link (задача 2.8, v1 demo).
 * URL: /claim?ref=<id>#s=<secret>. Shows what's waiting, then routes to
 * onboarding (create a wallet) to claim. Signed-in users can claim right away.
 * No chain action — v1 is a demo of the viral loop.
 */
export default function ClaimPage() {
  const router = useRouter();
  const { user, isDemo } = useAuth();
  const { t } = useLanguage();
  const [status, setStatus] = useState<ClaimStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimed, setClaimed] = useState<{ asset: string; amount: number } | null>(null);
  const [error, setError] = useState('');
  const refData = useRef<{ ref: string; secret: string } | null>(null);
  const openedFired = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!claimLinksEnabled()) { setLoading(false); setError(t('claimDisabled')); return; }
    const parsed = parseClaimFromLocation(window.location);
    if (!parsed || !parsed.ref) { setLoading(false); setError(t('claimBadLink')); return; }
    refData.current = parsed;
    (async () => {
      const s = await fetchClaimStatus(parsed.ref);
      setStatus(s);
      setLoading(false);
      if (s && !openedFired.current) {
        openedFired.current = true;
        track('claim_link_opened', { asset: s.asset, network: s.network, demo: s.isDemo });
        if (s.status === 'expired') track('claim_link_expired', { demo: s.isDemo });
        if (s.status === 'funded') savePendingClaim(parsed.ref, parsed.secret);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doClaim = async () => {
    if (!refData.current) return;
    setError('');
    const r = await completeClaim(refData.current.ref, refData.current.secret);
    if ('error' in r) { setError(t('claimFailed')); return; }
    clearPendingClaim();
    setClaimed({ asset: r.asset, amount: r.amount });
  };

  const goOnboard = () => router.push('/onboarding');

  const canClaimNow = !!user && !isDemo && status?.status === 'funded';

  return (
    <main className="min-h-screen flex flex-col items-center justify-center max-w-[430px] mx-auto px-6 text-center" style={{ backgroundColor: '#080C09' }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: 'rgba(0,255,127,0.1)', border: '1px solid rgba(0,255,127,0.25)' }}>
        <span style={{ fontSize: 34 }}>🎁</span>
      </div>

      {loading ? (
        <p className="text-[#3A6045] text-sm">…</p>
      ) : claimed ? (
        <>
          <p className="text-white text-xl font-bold">{t('claimDone')}</p>
          <p className="text-[#00FF7F] text-2xl font-bold mt-2">{claimed.amount} {coinLabel(claimed.asset)}</p>
          <p className="text-[#3A6045] text-xs mt-2">{t('claimDemoNote')}</p>
          <button onClick={() => router.push('/wallet')} className="mt-8 w-full py-4 rounded-2xl font-semibold text-sm" style={{ background: '#00FF7F', color: '#080C09' }}>
            {t('claimOpenWallet')}
          </button>
        </>
      ) : error ? (
        <p className="text-[#FF6B6B] text-sm">{error}</p>
      ) : status?.status === 'funded' ? (
        <>
          <p className="text-white text-lg font-semibold">{t('claimYouGot')}</p>
          <p className="text-[#00FF7F] text-3xl font-bold mt-2">{status.amount} {coinLabel(status.asset)}</p>
          <p className="text-[#3A6045] text-sm mt-3">{t('claimCreateToGet')}</p>
          <p className="text-[#3A6045] text-[11px] mt-1 opacity-70">{t('claimDemoNote')}</p>
          {canClaimNow ? (
            <button onClick={doClaim} className="mt-8 w-full py-4 rounded-2xl font-semibold text-sm" style={{ background: '#00FF7F', color: '#080C09' }}>
              {t('claimNow')}
            </button>
          ) : (
            <button onClick={goOnboard} className="mt-8 w-full py-4 rounded-2xl font-semibold text-sm" style={{ background: '#00FF7F', color: '#080C09' }}>
              {t('claimCreateWallet')}
            </button>
          )}
        </>
      ) : status?.status === 'expired' ? (
        <p className="text-[#3A6045] text-sm">{t('claimExpired')}</p>
      ) : status?.status === 'claimed' ? (
        <p className="text-[#3A6045] text-sm">{t('claimAlready')}</p>
      ) : (
        <p className="text-[#3A6045] text-sm">{t('claimBadLink')}</p>
      )}
    </main>
  );
}
