import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // tsconfig has "jsx": "preserve" (Next.js compiles JSX itself). Vite 8
  // (vitest 4) transforms with oxc and needs the JSX runtime set explicitly.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
  },
});
