import { defineConfig, devices } from '@playwright/test';

// Uses the locally installed Microsoft Edge so no browser download is needed.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', channel: 'msedge' },
  projects: [
    { name: 'mobile-375', use: { ...devices['Desktop Edge'], viewport: { width: 375, height: 812 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Edge'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Edge'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: 'npm run dev:server', url: 'http://127.0.0.1:3001/api/v1/health', reuseExistingServer: true },
    { command: 'npm run dev:web', url: 'http://localhost:5173', reuseExistingServer: true },
  ],
});
