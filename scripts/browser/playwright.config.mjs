import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Replit's Nix-compatible browser has its runtime libraries wired in; upstream
// Playwright downloads assume a conventional Linux loader/library layout.
const executablePath = process.env.CLAIMS_BROWSER_CHROMIUM ||
  (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Never start the backend: these tests need only the managed Tripwire frontend.
  outputDir: '../../generated-artifacts/claims-browser',
  reporter: 'list',
  use: {
    baseURL: process.env.CLAIMS_BROWSER_BASE_URL || 'http://localhost:80',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
