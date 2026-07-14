import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CLAIM_ASSETS, CLAIM_DEFAULT_ASSET, type ClaimAsset } from '@/lib/claim-config';
import { createClaimLink } from '@/lib/claim-client';
import { DEMO_HOLDING } from '@/lib/demo-data';
import { coinLabel } from '@/lib/coin-labels';
import { sanitizeAmountInput } from '@/lib/display-format';

/**
 * components/ClaimCreate.tsx — sender flow for a claim link (задача 2.8, v1 demo).
 * Demo-only: amount is capped at the demo balance; NO chain action — createClaimLink
 * only calls /api/claim/create. TON-first: default asset = USDT_TON.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://neurowallet.tech';

export const ClaimCreate: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [asset, setAsset] = useState<ClaimAsset>(CLAIM_DEFAULT_ASSET);
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const demoBalance = DEMO_HOLDING[asset]?.amount ?? 0;
  const amountNum = parseFloat(amount) || 0;

  const create = async () => {
    setError('');
    if (amountNum <= 0) return;
    if (amountNum > demoBalance) { setError(t('claimAmountExceeds')); return; }
    setCreating(true);
    const r = await createClaimLink({ asset, amount: amountNum, appUrl: APP_URL });
    setCreating(false);
    if ('error' in r) { setError(t('claimCreateError')); return; }
    setLink(r.url);
  };

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text: `${t('claimEntry')}: ${link}` });
      else { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* cancelled */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col max-w-[430px] mx-auto px-6 pt-14" style={{ background: '#080C09' }}>
      <button onClick={onClose} className="self-start text-[#3A6045] text-sm mb-4">✕</button>
      <h1 className="text-white text-2xl font-bold">{t('claimCreateTitle')}</h1>
      <p className="text-[#3A6045] text-sm mt-1 mb-6">{t('claimCreateHint')}</p>

      {!link ? (
        <>
          <div className="flex gap-2 mb-4">
            {CLAIM_ASSETS.map((a) => (
              <button key={a} onClick={() => setAsset(a)}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold"
                style={{ background: asset === a ? 'rgba(0,255,127,0.12)' : '#0D1A10', border: `1px solid ${asset === a ? '#00FF7F' : 'rgba(0,255,127,0.12)'}`, color: asset === a ? '#00FF7F' : '#fff' }}>
                {coinLabel(a)}
              </button>
            ))}
          </div>
          <input
            type="text" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
            placeholder={t('claimCreateAmountPh')}
            className="w-full rounded-xl px-4 py-3.5 text-white text-sm outline-none"
            style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)', caretColor: '#00FF7F' }}
          />
          <p className="text-[#3A6045] text-xs mt-1">{t('claimDemoNote')} · {demoBalance} {coinLabel(asset)}</p>
          {error && <p className="text-xs mt-2" style={{ color: '#FF6B6B' }}>{error}</p>}
          <button onClick={create} disabled={creating || amountNum <= 0}
            className="mt-6 w-full py-4 rounded-2xl font-semibold text-sm disabled:opacity-40"
            style={{ background: '#00FF7F', color: '#080C09' }}>
            {creating ? t('claimCreating') : t('claimCreateBtn')}
          </button>
        </>
      ) : (
        <>
          <p className="text-[#00FF7F] text-sm font-semibold mb-2">{t('claimLinkReady')}</p>
          <p className="text-white text-xs font-mono break-all rounded-xl px-3 py-3" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.12)' }}>{link}</p>
          <button onClick={share} className="mt-4 w-full py-4 rounded-2xl font-semibold text-sm" style={{ background: '#00FF7F', color: '#080C09' }}>
            {copied ? t('claimCopied') : t('claimShare')}
          </button>
        </>
      )}
    </div>
  );
};

export default ClaimCreate;
