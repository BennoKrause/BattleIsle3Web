import { defineConfig } from '@playwright/test';

// BI3_BASE_URL runs the tests against an already running build (dist/docker, dist/windows-portable) instead of the dev server
const external = process.env.BI3_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: 'research/e2e-results.json' }]],
  use: { baseURL: external ?? 'http://localhost:5173', viewport: { width: 1200, height: 900 } },
  webServer: external ? undefined : { command: 'npx vite --port 5173', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
});
