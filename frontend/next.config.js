/** @type {import('next').NextConfig} */

// Exact Supabase project origin, resolved at build time from the public env
// (NEXT_PUBLIC_* is inlined into the bundle anyway, nothing secret here).
// Fallback to the wildcard ONLY when the env is missing or unparsable (e.g. a
// local build without .env.local), so such a build still talks to Supabase.
function supabaseOrigin() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (raw) {
    try {
      const { protocol, origin } = new URL(raw);
      if (protocol === 'https:') return origin;
    } catch { /* fall through */ }
  }
  return 'https://*.supabase.co';
}

// Browser-side hosts only. Server-only upstreams (api.telegram.org for the
// bot, OpenRouter, provider keys) are NOT listed: the browser never calls them.
const connectSrc = [
  "'self'",
  supabaseOrigin(),
  // ETH JSON-RPC (client wallet code)
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io',
  'https://eth.drpc.org',
  'https://api.mainnet-beta.solana.com',
  'https://blockstream.info',
  'https://mempool.space',
  'https://api.etherscan.io',
  'https://api.coingecko.com',
  'https://api.trongrid.io',
  'https://toncenter.com',
  'https://tonapi.io',
].join(' ');

// Images: own assets, data: URLs (QR codes from the qrcode lib) and Telegram
// avatars (initDataUnsafe.user.photo_url → t.me/i/userpic/..., Telegram CDNs).
const imgSrc = [
  "'self'",
  'data:',
  'https://t.me',
  'https://*.t.me',
  'https://telegram.org',
  'https://*.telegram.org',
  'https://*.telesco.pe',
  'https://*.cdn-telegram.org',
].join(' ');

// Powerful features the app does not use. QR scanning is not implemented in
// the web view (no getUserMedia / BarcodeDetector), so camera is off too.
const permissionsPolicy = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

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
  `img-src ${imgSrc}`,
  `connect-src ${connectSrc}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Clickjacking protection that still lets Telegram Web (web.telegram.org —
  // K/A clients load Mini Apps in an iframe) embed us. Native Telegram apps use
  // a WebView, not an iframe, so they are unaffected. Replaces the former
  // X-Frame-Options: SAMEORIGIN, which blocked Telegram Web entirely.
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  'report-uri /api/csp-report',
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
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: permissionsPolicy },
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
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
