import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real app in Chromium: PDF.js rendering, the
 * Fabric overlay, the redaction worker and the download page.
 *
 * By default they run against the Vite dev server. Set E2E_PREVIEW=1 to build
 * and test the production bundle instead (CSP, PWA and worker chunks included).
 */
const preview = process.env.E2E_PREVIEW === '1';
const port = preview ? 4173 : 5173;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: preview
      ? `npm run build && npm run preview -- --port ${port} --strictPort`
      : `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
