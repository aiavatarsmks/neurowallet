/**
 * pages/pay/[id].tsx — публичная страница платёжной ссылки (задача 1.5).
 * Открывается ПЛАТЕЛЬЩИКОМ (в т.ч. без логина): показывает монету, сумму,
 * адрес и QR; истёкшая/закрытая ссылка отображается честно.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import QRCode from 'qrcode';
import { useLanguage } from '@/contexts/LanguageContext';
import { coinLabel } from '@/lib/coin-labels';

interface PayRequest {
  id: string;
  status: 'active' | 'completed' | 'cancelled' | 'expired';
  coin?: string;
  amount?: number | null;
  address?: string;
  expires_at?: string;
}

export default function PayPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [req, setReq] = useState<PayRequest | null>(null);
  const [error, setError] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  const id = typeof router.query.id === 'string' ? router.query.id : '';

  useEffect(() => {
    if (!id) return;
    fetch(`/api/payment-request?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => (data?.status ? setReq(data) : setError(true)))
      .catch(() => setError(true));
  }, [id]);

  useEffect(() => {
    if (!req?.address) return;
    QRCode.toDataURL(req.address, { errorCorrectionLevel: 'M', margin: 2, width: 190 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [req?.address]);

  const copy = () => {
    if (!req?.address) return;
    navigator.clipboard.writeText(req.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6" style={{ background: '#080C09' }}>
      <Head><title>NeuroWallet — {t('payTitle')}</title></Head>

      <p className="text-[#00FF7F] font-bold text-lg">NeuroWallet</p>

      {error && <p className="text-white text-sm">{t('payNotFound')}</p>}

      {req && req.status !== 'active' && (
        <div className="rounded-2xl p-5 text-center" style={{ background: '#0D1A10', border: '1px solid rgba(247,147,26,0.25)' }}>
          <p className="text-sm" style={{ color: '#F7931A' }}>
            {req.status === 'expired' ? t('payExpired') : req.status === 'completed' ? t('payCompleted') : t('payCancelled')}
          </p>
        </div>
      )}

      {req && req.status === 'active' && (
        <>
          <div className="rounded-2xl p-5 flex flex-col items-center gap-3 w-full max-w-sm" style={{ background: '#0D1A10', border: '1px solid rgba(0,255,127,0.15)' }}>
            <p className="text-[#3A6045] text-xs uppercase tracking-wider">{t('payRequestLabel')}</p>
            <p className="text-white text-2xl font-bold">
              {req.amount ? `${req.amount} ${coinLabel(req.coin ?? '')}` : `${coinLabel(req.coin ?? '')} — ${t('payAnyAmount')}`}
            </p>
            {qr && (
              <div className="rounded-2xl p-4" style={{ background: 'white' }}>
                <img src={qr} alt="QR" width={190} height={190} className="block" />
              </div>
            )}
            <p className="text-white text-xs font-mono break-all text-center">{req.address}</p>
            <button
              onClick={copy}
              className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95"
              style={{ background: copied ? 'rgba(0,255,127,0.2)' : '#00FF7F', color: '#080C09' }}
            >
              {copied ? t('payCopied') : t('payCopyAddress')}
            </button>
          </div>
          {req.expires_at && (
            <p className="text-[#3A6045] text-xs">
              {t('payValidUntil')} {new Date(req.expires_at).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
