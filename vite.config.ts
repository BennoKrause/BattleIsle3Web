import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  // tools/build-dist.ts packs the (copyrighted) game data separately
  publicDir: process.env.BI3_NO_PUBLIC ? false : 'public',
  // @ts-expect-error vitest options are read by vitest, not by vite
  test: { include: ['tests/**/*.test.ts'] },
});
