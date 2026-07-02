import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';

export default function PrivacyPolicy() {
  const { t } = useLanguage();
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px', color: '#fff', background: '#080C09', minHeight: '100vh' }}>
      <Link href="/" style={{ color: '#00FF7F', fontSize: 14, display: 'inline-block', marginBottom: 24 }}>
        {t('privacyBack')}
      </Link>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('privacyTitle')}</h1>
      <p style={{ color: '#3A6045', fontSize: 13, marginBottom: 32 }}>{t('privacyLastUpdated')}</p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>{t('privacyStoreTitle')}</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        {t('privacyStoreText')}
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>{t('privacyNotStoreTitle')}</h2>
      <ul style={{ color: '#ccc', lineHeight: 1.8, fontSize: 14, paddingLeft: 20 }}>
        <li>{t('privacyNotStoreItem1')}</li>
        <li>{t('privacyNotStoreItem2')}</li>
      </ul>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>{t('privacyChatTitle')}</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        {t('privacyChatText')}
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>{t('privacyAnalyticsTitle')}</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        {t('privacyAnalyticsText')}
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>{t('privacyRisksTitle')}</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        {t('privacyRisksText')}
      </p>

      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, marginTop: 24 }}>{t('privacyContactTitle')}</h2>
      <p style={{ color: '#ccc', lineHeight: 1.6, fontSize: 14 }}>
        {t('privacyContactText')} <a href="mailto:support@neurowallet.tech" style={{ color: '#00FF7F' }}>support@neurowallet.tech</a>
      </p>
    </main>
  );
}
