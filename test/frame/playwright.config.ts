import { defineConfig } from '@playwright/test';

// VELLUM_CHROMIUM points at a Chromium binary when Playwright's own
// download is not available (for example a preinstalled headless shell).
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './global-setup.ts',
  use: {
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.VELLUM_CHROMIUM ? { executablePath: process.env.VELLUM_CHROMIUM } : {},
  },
});
