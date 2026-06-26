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

// Note: script-src keeps 'unsafe-inline' because Next.js injects inline scripts
// at build time. Full nonce-based CSP requires middleware (planned for prod).
// Moving CSP to HTTP headers is already a security improvement over <meta>:
// - frame-ancestors is respected (meta CSP ignores it)
// - cannot be overridden by injected DOM content
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  `connect-src ${connectSrc}`,
  "font-src 'self'",
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
