import { readFile } from 'node:fs/promises'

const pin = JSON.parse(await readFile(new URL('../.github/asteroid-dataset.json', import.meta.url), 'utf8'))
const site = new URL(process.env.SITE_URL ?? 'https://dajiaohuang.github.io/solar/')
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function fetchWithRetry(path, attempts = 12) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(new URL(path, site), { cache: 'no-store' })
      if (response.ok) return response
      lastError = new Error(`${path} returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await wait(Math.min(5_000 * attempt, 30_000))
  }
  throw lastError
}

const home = await fetchWithRetry('./')
if (!(await home.text()).includes('Solar Atlas')) throw new Error('Production homepage does not contain the application shell')
const pointer = await (await fetchWithRetry('./data/asteroids/dataset-version.json')).json()
if (pointer.activeVersion !== pin.version) throw new Error(`Production dataset ${pointer.activeVersion} does not match pin ${pin.version}`)
const manifestUrl = new URL(`./data/asteroids/${pointer.manifestPath}`, site)
const manifest = await (await fetchWithRetry(manifestUrl)).json()
if (manifest.version !== pin.version) throw new Error('Production manifest does not match the pinned dataset version')
for (const path of [
  manifest.precomputedSamples?.desktop?.metadataPath,
  manifest.precomputedSamples?.desktop?.binaryPath,
  manifest.precomputedSamples?.mobile?.metadataPath,
  manifest.precomputedSamples?.mobile?.binaryPath,
]) {
  if (!path) throw new Error('Production manifest omits a precomputed sample artifact')
  await fetchWithRetry(new URL(path, manifestUrl))
}
const serviceWorker = await fetchWithRetry('./sw.js')
if (!/javascript/i.test(serviceWorker.headers.get('content-type') ?? '')) throw new Error('Production service worker is not served as JavaScript')
console.log(`Production smoke test passed for ${site} with ${pin.version}`)
