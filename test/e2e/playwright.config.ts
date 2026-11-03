import { defineConfig } from '@playwright/test';

// End-to-end tests in a real Obsidian, with the built plugin installed in a
// fresh vault. Needs `npm run build` first and a display (xvfb-run on CI).
// OBSIDIAN_BIN overrides the Obsidian binary the global setup downloads.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './global-setup.ts',
});
