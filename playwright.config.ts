import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  use: { headless: true, viewport: { width: 620, height: 1100 } },
  reporter: 'list',
});
