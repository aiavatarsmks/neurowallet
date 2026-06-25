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
        {/*
          CSP:
          - frame-ancestors NOT set via meta (meta CSP cannot restrict framing; Telegram Mini App requires iframe)
          - script-src includes telegram.org for WebApp SDK
          - connect-src covers all APIs: ETH/SOL/BTC/Tron RPCs, Etherscan, CoinGecko, Supabase, Gonka
        */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://telegram.org",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "connect-src 'self'" +
              " https://*.supabase.co" +
              " https://gonkabroker.com https://*.gonkabroker.com" +
              " https://cloudflare-eth.com" +
              " https://api.mainnet-beta.solana.com" +
              " https://blockstream.info" +
              " https://mempool.space" +
              " https://api.etherscan.io" +
              " https://api.coingecko.com" +
              " https://api.trongrid.io" +
              " https://toncenter.com" +
              " https://api.telegram.org",
            "font-src 'self'",
          ].join('; ')}
        />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
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
