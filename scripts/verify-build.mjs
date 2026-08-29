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

async function requirePngDimensions(relativePath, expectedWidth, expectedHeight) {
  const content = await readFile(await requireFile(relativePath))
  const pngSignature = '89504e470d0a1a0a'
  if (content.length < 24 || content.subarray(0, 8).toString('hex') !== pngSignature) throw new Error(`${relativePath} is not a valid PNG`)
  const width = content.readUInt32BE(16), height = content.readUInt32BE(20)
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${relativePath} is ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`)
  }
}

for (const path of [
  'index.html', 'manifest.webmanifest', 'sw.js', 'build-info.json', 'health.json',
  'capacity-report.json', 'asset-manifest.json', 'sitemap.xml', 'robots.txt',
  'scientific-validation.json', 'validation/index.html', 'zh/validation/index.html',
  'stories/geocentric-model/index.html', 'zh/stories/geocentric-model/index.html',
  'stories/retrograde-mars/index.html', 'zh/stories/retrograde-mars/index.html',
  'objects/ceres/index.html', 'zh/objects/ceres/index.html', 'og-image.png',
  'og/stories/geocentric-model-en.png', 'og/stories/geocentric-model-zh.png',
  'og/stories/retrograde-mars-en.png', 'og/stories/retrograde-mars-zh.png',
  'og/objects/ceres-en.png', 'og/objects/ceres-zh.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'readme-screenshot.png',
]) await requireFile(path)

await Promise.all([
  requirePngDimensions('og-image.png', 1200, 630),
  requirePngDimensions('og/stories/geocentric-model-en.png', 1200, 630),
  requirePngDimensions('og/stories/geocentric-model-zh.png', 1200, 630),
  requirePngDimensions('og/stories/retrograde-mars-en.png', 1200, 630),
  requirePngDimensions('og/objects/ceres-zh.png', 1200, 630),
  requirePngDimensions('icons/icon-192.png', 192, 192),
  requirePngDimensions('icons/icon-512.png', 512, 512),
  requirePngDimensions('icons/icon-maskable-512.png', 512, 512),
  requirePngDimensions('readme-screenshot.png', 1440, 900),
])

const sw = await readFile(join(dist, 'sw.js'), 'utf8')
if (sw.includes('__BUILD_SHA__') || sw.includes('const PRECACHE_URLS = ["./"]')) {
  throw new Error('Service Worker build placeholders were not finalized')
}

const capacity = JSON.parse(await readFile(join(dist, 'capacity-report.json'), 'utf8'))
if (!capacity.withinBudget) throw new Error('Generated artifact exceeds its declared capacity budget')

const health = JSON.parse(await readFile(join(dist, 'health.json'), 'utf8'))
const scientificValidation = JSON.parse(await readFile(join(dist, 'scientific-validation.json'), 'utf8'))
if (scientificValidation.passed === false) throw new Error('Scientific validation report contains failures')
if (!scientificValidation.build?.commitSha) throw new Error('Scientific validation report is missing build identity')
if (scientificValidation.modelEvidence?.planetaryApproximation?.id !== 'jpl-approx-table-1') throw new Error('Scientific validation report is missing the planetary model identity')
if (scientificValidation.modelEvidence?.planetaryApproximation?.earthOrbitSeed !== 'earth-moon-barycenter') throw new Error('Scientific validation report is missing the Earth–Moon barycenter orbit seed')
if (scientificValidation.modelEvidence?.planetaryApproximation?.renderedEarthPoint !== 'earth-geocenter') throw new Error('Scientific validation report is missing the derived Earth geocenter identity')
if (scientificValidation.modelEvidence?.earthMoonMassPartition?.id !== 'de440-earth-moon-gm-partition-v1') throw new Error('Scientific validation report is missing the Earth–Moon mass-partition identity')
if (scientificValidation.modelEvidence?.earthMoonMassPartition?.sourceSha256 !== '924ddf4fb9ead9fe8a1aa55780bcabde40b09d00065d58226e24b68d8092f140') throw new Error('Scientific validation report is missing the canonical DE440 GM checksum')
if (scientificValidation.modelEvidence?.earthMoonMassPartition?.renderedEarthPoint !== 'earth-geocenter') throw new Error('Scientific validation report does not identify the rendered Earth geocenter')
if (scientificValidation.modelEvidence?.earthMoonMassPartition?.earthGm !== '3.9860043550702266E+05') throw new Error('Scientific validation report is missing the canonical DE440 Earth GM')
if (scientificValidation.modelEvidence?.earthMoonMassPartition?.moonGm !== '4.9028001184575496E+03') throw new Error('Scientific validation report is missing the canonical DE440 Moon GM')
if (scientificValidation.modelEvidence?.earthMoonMassPartition?.systemGm !== '4.0350323562548019E+05') throw new Error('Scientific validation report is missing the canonical DE440 Earth–Moon system GM')
if (scientificValidation.modelEvidence?.satelliteOrbits?.id !== 'satellite-two-body-contract-v2') throw new Error('Scientific validation report is missing the satellite model identity')
if (scientificValidation.modelEvidence?.satelliteOrbits?.sourceWarning !== 'fixed-mean-and-epoch-osculating-ellipses-not-continuous-ephemerides') throw new Error('Scientific validation report is missing the satellite element precision boundary')
if (scientificValidation.modelEvidence?.satelliteOrbits?.moonSourceCenter !== 'earth-geocenter') throw new Error('Scientific validation report is missing the Moon source center')
if (scientificValidation.modelEvidence?.satelliteOrbits?.moonAppliedCenter !== 'earth-geocenter') throw new Error('Scientific validation report is missing the corrected Moon applied center')
if (scientificValidation.modelEvidence?.satelliteOrbits?.moonCenterHandling !== 'de440-gm-barycentric-partition') throw new Error('Scientific validation report does not disclose the Earth–Moon center partition')
if (scientificValidation.modelEvidence?.satelliteOrbits?.sourcedBodies?.join(',') !== 'moon,io,europa,ganymede,callisto,titan') throw new Error('Scientific validation report does not identify every sourced satellite model')
if (scientificValidation.modelEvidence?.satelliteOrbits?.illustrativeBodies?.length !== 0) throw new Error('Scientific validation report still identifies illustrative satellite elements')
if (scientificValidation.modelEvidence?.satelliteOrbits?.giantSatelliteFrameTransform !== 'identity-eclipj2000') throw new Error('Scientific validation report is missing the giant-satellite frame contract')
const planetaryModelEvidence = scientificValidation.modelEvidence.planetaryApproximation
const expectedPlanetaryModelWindow = `${planetaryModelEvidence.validFrom}/${planetaryModelEvidence.validTo}`
if (scientificValidation.modelWindow?.planetaryApproximation !== expectedPlanetaryModelWindow) throw new Error('Scientific validation model window is inconsistent with the canonical model evidence')
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
