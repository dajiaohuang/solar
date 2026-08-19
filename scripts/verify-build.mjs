import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const dist = resolve('dist')

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

async function requireFile(relativePath) {
  const path = join(dist, ...relativePath.split('/'))
  if (!await exists(path)) throw new Error(`Required build artifact is missing: ${relativePath}`)
  return path
}

for (const path of [
  'index.html', 'manifest.webmanifest', 'sw.js', 'build-info.json', 'health.json',
  'capacity-report.json', 'asset-manifest.json', 'sitemap.xml', 'robots.txt',
  'stories/retrograde-mars/index.html', 'zh/stories/retrograde-mars/index.html',
  'objects/ceres/index.html', 'zh/objects/ceres/index.html', 'og-image.png',
  'icons/icon-192.png', 'icons/icon-512.png',
]) await requireFile(path)

const sw = await readFile(join(dist, 'sw.js'), 'utf8')
if (sw.includes('__BUILD_SHA__') || sw.includes('const PRECACHE_URLS = ["./"]')) {
  throw new Error('Service Worker build placeholders were not finalized')
}

const capacity = JSON.parse(await readFile(join(dist, 'capacity-report.json'), 'utf8'))
if (!capacity.withinBudget) throw new Error('Generated artifact exceeds its declared capacity budget')

const health = JSON.parse(await readFile(join(dist, 'health.json'), 'utf8'))
if (health.dataset?.included) {
  const version = health.dataset.version
  const release = `data/asteroids/releases/${version}`
  await requireFile('data/asteroids/dataset-version.json')
  const manifestPath = await requireFile(`${release}/manifest.json`)
  await requireFile(`${release}/delivery-manifest.json`)
  await requireFile(`${release}/catalog-sample-desktop.json.gz`)
  await requireFile(`${release}/catalog-sample-desktop.bin`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!manifest.capabilities?.includes('gzip-json-v1')) throw new Error('Deployable dataset manifest does not declare gzip-json-v1')
  if (await exists(join(dist, ...`${release}/catalog-sample-desktop.json`.split('/')))) {
    throw new Error('Deployable artifact unexpectedly contains the uncompressed desktop sample JSON')
  }
}

process.stdout.write('Build artifact contract verified.\n')
