import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  use: {
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 620, height: 1100 },
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  reporter: 'list',
});
