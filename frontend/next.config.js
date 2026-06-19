/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
