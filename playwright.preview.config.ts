import { defineConfig, devices } from '@playwright/test'

const externalURL = process.env.PREVIEW_TEST_BASE_URL
const baseURL = externalURL ?? 'http://127.0.0.1:4197/solar/'

export default defineConfig({
  testDir: './tests/preview',
  outputDir: 'test-results-preview',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL, serviceWorkers: 'block', channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL, trace: 'retain-on-failure' },
  webServer: externalURL ? undefined : {
    command: 'npx cross-env SOLAR_ATLAS_PRODUCT_PROFILE=preview SOLAR_ATLAS_INCLUDE_DATASET=1 npm run build && npm run preview -- --host 127.0.0.1 --port 4197 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'preview-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'preview-mobile', use: { ...devices['Pixel 7'] } },
  ],
})
