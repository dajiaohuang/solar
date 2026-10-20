import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/vercel',
  outputDir: 'test-results-vercel',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:4198/', serviceWorkers: 'block', channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL, trace: 'retain-on-failure' },
  webServer: {
    command: 'npx cross-env SOLAR_ATLAS_WEB_EXECUTION=segmented npm run preview -- --host 127.0.0.1 --port 4198 --strictPort',
    url: 'http://127.0.0.1:4198/',
    reuseExistingServer: false,
  },
  projects: [{ name: 'vercel-desktop', use: { ...devices['Desktop Chrome'] } }],
})
