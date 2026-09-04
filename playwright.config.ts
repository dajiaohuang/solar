import { defineConfig, devices } from '@playwright/test'

const reuseBuild = process.env.PLAYWRIGHT_REUSE_BUILD === '1'
const fullBrowserMatrix = process.env.FULL_BROWSER_MATRIX === '1'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // The trajectory and catalog workers share the browser host CPU. Keep the
  // full adapter run bounded in CI so parallel pages do not starve the worker
  // completion signal that the interaction assertions observe.
  workers: fullBrowserMatrix || process.env.CI ? 4 : undefined,
  retries: process.env.CI ? 2 : 0,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4187/solar/',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
  },
  webServer: {
    // Full-Web E2E uses a same-origin test-only adapter. Deploy and Pages
    // builds never inherit this value; they use their own build commands.
    command: `${reuseBuild ? '' : 'cross-env VITE_SOLAR_API_BASE_URL=/solar-test-api npm run build && '}cross-env VITE_SOLAR_API_BASE_URL=/solar-test-api npm run preview -- --host 127.0.0.1 --port 4187`,
    url: 'http://127.0.0.1:4187/solar/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    ...(fullBrowserMatrix ? [
      { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'], channel: undefined } },
      { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], channel: undefined } },
    ] : []),
  ],
})
