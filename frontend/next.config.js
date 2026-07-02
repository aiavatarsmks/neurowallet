/** @type {import('next').NextConfig} */

const connectSrc = [
  "'self'",
  'https://*.supabase.co',
  'https://gonkabroker.com',
  'https://*.gonkabroker.com',
  'https://cloudflare-eth.com',
  'https://api.mainnet-beta.solana.com',
  'https://blockstream.info',
  'https://mempool.space',
  'https://api.etherscan.io',
  'https://api.coingecko.com',
  'https://api.trongrid.io',
  'https://toncenter.com',
  'https://tonapi.io',
  'https://api.telegram.org',
].join(' ');

// script-src has no 'unsafe-inline': verified against the production build —
// the only inline <script> Next.js (Pages Router) emits is __NEXT_DATA__ with
// type="application/json", which is not executable and not subject to
// script-src. All executable scripts are external (self / telegram.org).
// style-src keeps 'unsafe-inline' — required by styled-jsx and inline styles.
// Violations are reported to /api/csp-report (rate-limited, deduplicated).
const csp = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  `connect-src ${connectSrc}`,
  "font-src 'self'",
  'report-uri /api/csp-report',
  // frame-ancestors intentionally omitted: Telegram Mini App embeds us in an iframe
].join('; ');

const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        // HTML pages — never cache (Telegram Mini App WebView caches aggressively)
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
      {
        // Static JS/CSS assets — long cache (they're content-hashed by Next.js)
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },

  // Three.js uses browser APIs — exclude from SSR transpilation
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        'three',
        '@react-three/fiber',
        '@react-three/drei',
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
