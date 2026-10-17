import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3197',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3197',
    url: 'http://127.0.0.1:3197/conversations',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
