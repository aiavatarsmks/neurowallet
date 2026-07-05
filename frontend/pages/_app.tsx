import '@/styles/globals.css';
import { useEffect } from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { DisplayCurrencyProvider } from '@/contexts/DisplayCurrencyContext';
import { useTelegramInit } from '@/hooks/useTelegram';
import { clearLegacyXorKeys } from '@/lib/crypto/wallet';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Inner component so useTelegramInit can run inside AuthProvider tree
function AppInner({ Component, pageProps }: AppProps) {
  useTelegramInit();
  // Purge stale XOR-era blobs (scheme removed in 4b3704e) from localStorage.
  useEffect(() => clearLegacyXorKeys(), []);
  return <Component {...pageProps} />;
}

export default function App(props: AppProps) {
  return (
    <ErrorBoundary>
    <LanguageProvider>
      <DisplayCurrencyProvider>
      <AuthProvider>
        <Head>
          {/*
            viewport-fit=cover: fills the entire screen in Telegram Mini App (no safe-area gaps at top/bottom)
          */}
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
          <meta name="theme-color" content="#080C09" />
          {/* CSP and security headers are set via next.config.js (HTTP headers) */}
          <link rel="icon" href="/favicon.ico" sizes="any" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <title>NeuroWallet</title>
        </Head>

        {/* Telegram Mini App SDK — must load before React hydration */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />

        <AppInner {...props} />
      </AuthProvider>
      </DisplayCurrencyProvider>
    </LanguageProvider>
    </ErrorBoundary>
  );
}
