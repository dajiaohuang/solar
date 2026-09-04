import { readFile } from 'node:fs/promises'
import { jsonDocument, productDelivery, sha256 } from './lib/product-delivery.ts'
import { previewDatasetPlan } from './lib/preview-dataset.mjs'
import { fetchArtifactBytes } from './lib/fetch-artifact-bytes.mjs'

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
const delivery = productDelivery(undefined, health.build?.productProfile, health.build?.ephemerisProfile)
const isPreview = delivery.product === 'preview'
if (!health.dataset?.included || health.dataset.root !== delivery.catalogDirectory) throw new Error('Production dataset root differs from the active product')
const availability = await (await fetchWithRetry('./product-availability.json')).text()
if (availability !== jsonDocument(delivery.availability) || sha256(availability) !== health.build.productAvailabilitySha256) throw new Error('Production availability identity mismatch')
const pointer = await (await fetchWithRetry(`./${delivery.catalogDirectory}/dataset-version.json`)).json()
if (pointer.activeVersion !== pin.version) throw new Error(`Production dataset ${pointer.activeVersion} does not match pin ${pin.version}`)
if (pointer.manifestPath !== `releases/${pin.version}/manifest.json`) throw new Error('Production pointer has an unexpected manifest path')
const manifestUrl = new URL(`./${delivery.catalogDirectory}/${pointer.manifestPath}`, site)
const manifest = await (await fetchWithRetry(manifestUrl)).json()
if (manifest.version !== pin.version) throw new Error('Production manifest does not match the pinned dataset version')
if (!manifest.summaryPath || (!isPreview && !manifest.compactIndex?.path)) throw new Error('Production manifest omits required catalog artifacts')
const deliveredPath = (path) => {
  const fileName = path?.split('/').at(-1)
  const compressed = manifest.capabilities?.includes('gzip-json-v1')
    && manifest.delivery?.compressedRootArtifacts?.includes(fileName)
  return compressed ? `${path}.gz` : path
}
if (!isPreview) await fetchWithRetry(new URL(manifest.compactIndex.path, manifestUrl), 12, { method: 'HEAD' })
const summary = await (await fetchWithRetry(new URL(manifest.summaryPath, manifestUrl))).json()
if (summary.totalCount !== manifest.totalCount) throw new Error('Production catalog summary does not match the manifest count')
const samplePaths = [
  ...(isPreview ? [] : [
  manifest.precomputedSamples?.desktop?.metadataPath,
  manifest.precomputedSamples?.desktop?.binaryPath,
  ]),
  manifest.precomputedSamples?.mobile?.metadataPath,
  manifest.precomputedSamples?.mobile?.binaryPath,
]
for (const path of samplePaths) {
  if (!path) throw new Error('Production manifest omits a precomputed sample artifact')
  await fetchWithRetry(new URL(deliveredPath(path), manifestUrl))
}
if (isPreview) {
  const expected = previewDatasetPlan(manifest, delivery.availabilitySha256)
  if (JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) throw new Error('Production preview advertises unavailable resources')
  const expectedDeliveryPath = `${delivery.catalogDirectory}/releases/${pin.version}/delivery-manifest.json`
  if (health.dataset.deliveryManifestPath !== expectedDeliveryPath) throw new Error('Production preview delivery path mismatch')
  const deliveredText = await (await fetchWithRetry(`./${expectedDeliveryPath}`)).text()
  if (sha256(deliveredText) !== health.dataset.deliveryManifestSha256) throw new Error('Production preview delivery hash mismatch')
  const delivered = JSON.parse(deliveredText)
  const expectedFiles = expected.sourcePaths.map(path => path === 'catalog-sample-mobile.json' ? `${path}.gz` : path).sort()
  if (delivered.delivery?.profile !== 'preview' || delivered.delivery?.availabilitySha256 !== delivery.availabilitySha256
    || delivered.sourceContentSha256 !== manifest.contentSha256
    || JSON.stringify(delivered.files.map(file => file.path).sort()) !== JSON.stringify(expectedFiles)
    || sha256(JSON.stringify(delivered.files)) !== delivered.deliveredContentSha256) throw new Error('Production preview delivery identity mismatch')
  for (const file of delivered.files) {
    const bytes = await fetchArtifactBytes(new URL(file.path, manifestUrl), file.bytes)
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Production preview checksum mismatch: ${file.path}`)
  }
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
    const context = await browser.newContext()
    await context.addInitScript(() => localStorage.setItem('solar-atlas-language', 'en'))
    const page = await context.newPage()
    const pageErrors = []
    const rendererRequests = []
    const catalogRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('TrajectoryCanvas3D-')) rendererRequests.push(request.url())
      if (request.url().includes('/data/asteroids/')) catalogRequests.push(request.url())
    })
    await page.goto(site.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('.trajectory-3d-placeholder').waitFor({ state: 'visible', timeout: 60_000 })
    await page.locator('.first-run-choice').waitFor({ state: 'visible', timeout: 60_000 })
    if (rendererRequests.length) throw new Error('Production first-visit choice requested the deferred 3D renderer')
    await page.locator('.first-run-choice .quiet-button').click()
    await page.getByTestId('trajectory-canvas-3d').waitFor({ state: 'visible', timeout: 60_000 })
    if (rendererRequests.length !== 1) throw new Error(`Production requested the 3D renderer ${rendererRequests.length} times after the onboarding choice`)
    const presetCount = await page.locator('.preset-list > button').count()
    if (presetCount < 11) throw new Error(`Production deck exposes only ${presetCount} preset scenes`)
    if (await page.locator('.advanced-controls').evaluate((element) => element.hasAttribute('open'))) {
      throw new Error('Production deck opens advanced controls by default')
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByTestId('trajectory-canvas-3d').waitFor({ state: 'visible', timeout: 60_000 })
    if (await page.locator('.first-run-choice').count()) throw new Error('Production showed the first-run choice after onboarding completion')
    console.log(`Confirmed deferred first visit and returning 3D Observation Deck with ${presetCount} scenes`)
    const catalogControl = page.locator('.primary-navigation button', { hasText: 'Catalog' })
    if (isPreview) {
      if (await catalogControl.getAttribute('aria-disabled') !== 'true') throw new Error('Production preview permits the full catalog')
      await catalogControl.focus()
      await catalogControl.press('Enter')
      const dialog = page.locator('dialog.preview-availability')
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await page.getByTestId('preset-mars-main-belt-jupiter').click()
      await page.locator('.element-scatter').waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForFunction(() => {
        const caption = document.querySelector('.sample-caption')?.textContent ?? ''
        const count = caption.match(/showing\s+([\d,]+)\s*\//i)?.[1]
        return count !== undefined && Number(count.replaceAll(',', '')) > 0
      }, undefined, { timeout: 60_000 })
      if (new URL(page.url()).searchParams.get('catalogSampleCount') !== '8000') throw new Error('Production preview changed its source sample identity')
      if (catalogRequests.some(url => !url.includes(`/${delivery.catalogDirectory}/`) || /catalog-index|catalog-sample-desktop|\/(chunks|search|lookup)\//.test(url))) throw new Error('Production preview requested a full-only catalog resource')
      console.log('Confirmed production preview restriction and curated catalog sample')
    } else {
      await catalogControl.click()
      await page.getByRole('heading', { name: 'Catalog' }).waitFor({ state: 'visible', timeout: 60_000 })
      await page.locator('.catalog-counts').waitFor({ state: 'visible', timeout: 60_000 })
      console.log('Confirmed production catalog hydration')
    }
    if (pageErrors.length) throw new Error(`Production browser reported errors: ${pageErrors.join(' | ')}`)
    await context.close()
  } finally {
    await browser.close()
  }
}
console.log(`Production smoke test passed for ${site} at ${health.build?.commitSha ?? 'unknown'} with ${pin.version}`)
