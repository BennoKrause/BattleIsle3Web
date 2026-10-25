import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error plain JavaScript module of the package server, without type declarations
import { savesApi } from './tools/portable/saves.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const savesDir = resolve(import.meta.dirname, process.env.BI3_SAVES ?? 'saves');

export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  // tools/build-dist.ts packs the (copyrighted) game data separately
  publicDir: process.env.BI3_NO_PUBLIC ? false : 'public',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // save games on the server like tools/portable/server.mjs
  plugins: [{
    name: 'bi3-saves',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path === '/__saves' || path.startsWith('/__saves/')) void savesApi(savesDir, req, res, path);
        else next();
      });
    },
  }],
  // @ts-expect-error vitest options are read by vitest, not by vite
  test: { include: ['tests/**/*.test.ts'] },
});
