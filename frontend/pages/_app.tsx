import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import { AuthProvider } from '@/contexts/AuthContext';
import { useTelegramInit } from '@/hooks/useTelegram';

// Inner component so useTelegramInit can run inside AuthProvider tree
function AppInner({ Component, pageProps }: AppProps) {
  useTelegramInit();
  return <Component {...pageProps} />;
}

export default function App(props: AppProps) {
  return (
    <AuthProvider>
      <Head>
        {/*
          viewport-fit=cover: fills the entire screen in Telegram Mini App (no safe-area gaps at top/bottom)
        */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#080C09" />
        {/* CSP and security headers are set via next.config.js (HTTP headers) */}
        <title>NeuroWallet</title>
      </Head>

      {/* Telegram Mini App SDK — must load before React hydration */}
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />

      <AppInner {...props} />
    </AuthProvider>
  );
}
