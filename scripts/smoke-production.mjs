import { readFile } from 'node:fs/promises'

const pin = JSON.parse(await readFile(new URL('../.github/asteroid-dataset.json', import.meta.url), 'utf8'))
const site = new URL(process.env.SITE_URL ?? 'https://dajiaohuang.github.io/solar/')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function fetchWithRetry(path, attempts = 12, init = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(new URL(path, site), {
        cache: 'no-store',
        signal: AbortSignal.timeout(60_000),
        ...init,
      })
      if (response.ok) return response
      lastError = new Error(`${path} returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) await wait(Math.min(5_000 * attempt, 30_000))
  }
  throw lastError
}

async function fetchExpectedHealth(attempts = 12) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = await (await fetchWithRetry('./health.json', 1)).json()
      if (health.status !== 'ok') throw new Error('Production health document does not report an OK status')
      if (process.env.GITHUB_SHA && health.build?.commitSha !== process.env.GITHUB_SHA) {
        throw new Error(`Production commit ${health.build?.commitSha ?? 'unknown'} does not match deployment ${process.env.GITHUB_SHA}`)
      }
      return health
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) await wait(Math.min(5_000 * attempt, 30_000))
  }
  throw lastError
}

console.log(`Checking production deployment at ${site}`)
const home = await fetchWithRetry('./')
if (!(await home.text()).includes('Solar Atlas')) throw new Error('Production homepage does not contain the application shell')
const health = await fetchExpectedHealth()
console.log(`Confirmed production build ${health.build?.commitSha ?? 'unknown'}`)
const pointer = await (await fetchWithRetry('./data/asteroids/dataset-version.json')).json()
if (pointer.activeVersion !== pin.version) throw new Error(`Production dataset ${pointer.activeVersion} does not match pin ${pin.version}`)
const manifestUrl = new URL(`./data/asteroids/${pointer.manifestPath}`, site)
const manifest = await (await fetchWithRetry(manifestUrl)).json()
if (manifest.version !== pin.version) throw new Error('Production manifest does not match the pinned dataset version')
if (!manifest.compactIndex?.path || !manifest.summaryPath) throw new Error('Production manifest omits compact-index or summary artifacts')
const deliveredPath = (path) => {
  const fileName = path?.split('/').at(-1)
  const compressed = manifest.capabilities?.includes('gzip-json-v1')
    && manifest.delivery?.compressedRootArtifacts?.includes(fileName)
  return compressed ? `${path}.gz` : path
}
await fetchWithRetry(new URL(manifest.compactIndex.path, manifestUrl), 12, { method: 'HEAD' })
const summary = await (await fetchWithRetry(new URL(manifest.summaryPath, manifestUrl))).json()
if (summary.totalCount !== manifest.totalCount) throw new Error('Production catalog summary does not match the manifest count')
for (const path of [
  manifest.precomputedSamples?.desktop?.metadataPath,
  manifest.precomputedSamples?.desktop?.binaryPath,
  manifest.precomputedSamples?.mobile?.metadataPath,
  manifest.precomputedSamples?.mobile?.binaryPath,
]) {
  if (!path) throw new Error('Production manifest omits a precomputed sample artifact')
  await fetchWithRetry(new URL(deliveredPath(path), manifestUrl))
}
const serviceWorker = await fetchWithRetry('./sw.js')
if (!/javascript/i.test(serviceWorker.headers.get('content-type') ?? '')) throw new Error('Production service worker is not served as JavaScript')
console.log(`Confirmed production dataset ${pin.version} and delivery endpoints`)

if (process.env.SMOKE_BROWSER === '1') {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch(process.env.SMOKE_BROWSER_CHANNEL
    ? { channel: process.env.SMOKE_BROWSER_CHANNEL }
    : undefined)
  try {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('solar-atlas-language', 'en')
      localStorage.setItem('solar-atlas-first-run-v1', 'complete')
    })
    await page.goto(site.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('.welcome-workspace').waitFor({ state: 'visible', timeout: 60_000 })
    console.log('Confirmed visitor landing page')
    await page.locator('.welcome-primary-actions .primary-button').click()
    await page.getByTestId('trajectory-canvas-3d').waitFor({ state: 'visible', timeout: 60_000 })
    console.log('Confirmed landing-to-explorer path')
    await page.locator('.primary-navigation button', { hasText: 'Catalog' }).click()
    await page.getByRole('heading', { name: 'Catalog' }).waitFor({ state: 'visible', timeout: 60_000 })
    await page.locator('.catalog-counts').waitFor({ state: 'visible', timeout: 60_000 })
    console.log('Confirmed production catalog hydration')
    if (pageErrors.length) throw new Error(`Production browser reported errors: ${pageErrors.join(' | ')}`)
  } finally {
    await browser.close()
  }
}
console.log(`Production smoke test passed for ${site} at ${health.build?.commitSha ?? 'unknown'} with ${pin.version}`)
