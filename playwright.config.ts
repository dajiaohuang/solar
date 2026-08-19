import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4187/solar/',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
  },
  webServer: { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4187', url: 'http://127.0.0.1:4187/solar/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
