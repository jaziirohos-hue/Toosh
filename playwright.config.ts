import { defineConfig, devices } from '@playwright/test';

// Browser end-to-end tests against a running API that serves the built app (see README "End-to-end tests").
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8787',
    ...devices['Pixel 7'],
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results',
});
