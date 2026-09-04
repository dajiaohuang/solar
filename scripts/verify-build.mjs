import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { jsonDocument, productDelivery, sha256 } from './lib/product-delivery.ts'
import { previewDatasetPlan } from './lib/preview-dataset.mjs'
import { verifyEphemerisAssets } from './lib/verify-ephemeris-assets.mjs'

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
  'capacity-report.json', 'asset-manifest.json', 'sitemap.xml', 'robots.txt', 'product-availability.json', 'ephemeris-manifest.json',
  'scientific-validation.json', 'validation/index.html', 'zh/validation/index.html',
  'privacy/index.html', 'zh/privacy/index.html',
  'stories/geocentric-model/index.html', 'zh/stories/geocentric-model/index.html',
  'stories/retrograde-mars/index.html', 'zh/stories/retrograde-mars/index.html',
  'objects/ceres/index.html', 'zh/objects/ceres/index.html', 'og-image.png',
  'og/stories/geocentric-model-en.png', 'og/stories/geocentric-model-zh.png',
  'og/stories/retrograde-mars-en.png', 'og/stories/retrograde-mars-zh.png',
  'og/objects/ceres-en.png', 'og/objects/ceres-zh.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'readme-screenshot.png',
]) await requireFile(path)

const urlStateSource = await readFile(resolve('src/lib/urlState.ts'), 'utf8')
const sceneVersionMatch = urlStateSource.match(/export const SCENE_URL_VERSION = (\d+)/)
if (!sceneVersionMatch) throw new Error('Unable to read the canonical scene URL version')
const currentSceneVersion = sceneVersionMatch[1]
for (const path of [
  'manifest.webmanifest',
  'stories/geocentric-model/index.html',
  'objects/ceres/index.html',
  'about/index.html',
  'privacy/index.html',
  'zh/privacy/index.html',
]) {
  const content = await readFile(join(dist, ...path.split('/')), 'utf8')
  if (!content.includes(`?v=${currentSceneVersion}`)) throw new Error(`${path} does not publish the current v${currentSceneVersion} scene URL`)
  if (/\?v=(?:2|3)(?:&|&amp;)/.test(content)) throw new Error(`${path} still publishes a legacy scene URL`)
  if (!/(?:&|&amp;)view=3d(?:&|&amp;|"|')/.test(content)) throw new Error(`${path} does not publish a 3D-first internal entry`)
}

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
const buildInfo = JSON.parse(await readFile(join(dist, 'build-info.json'), 'utf8'))
const delivery = productDelivery(undefined, buildInfo.productProfile, buildInfo.ephemerisProfile)
const availabilityText = await readFile(join(dist, 'product-availability.json'), 'utf8')
if (availabilityText !== jsonDocument(delivery.availability) || sha256(availabilityText) !== buildInfo.productAvailabilitySha256) throw new Error('Product availability identity mismatch')
if (capacity.productProfile !== delivery.product || capacity.productAvailabilitySha256 !== delivery.availabilitySha256) throw new Error('Capacity report product identity mismatch')
if (await readFile(join(dist, 'ephemeris-manifest.json'), 'utf8') !== jsonDocument(delivery.manifest)) throw new Error('Packaged ephemeris manifest differs from runtime selection')
const ephemerisBytes = await verifyEphemerisAssets(join(dist, 'data', 'ephemerides'), delivery.manifest.files)
if (capacity.ephemerisTotalBytes !== ephemerisBytes) throw new Error('Capacity report ephemeris size mismatch')

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
  if (!/^[a-zA-Z0-9._-]+$/.test(version) || health.dataset.root !== delivery.catalogDirectory) throw new Error('Invalid dataset delivery path')
  const release = `${delivery.catalogDirectory}/releases/${version}`
  await requireFile(`${delivery.catalogDirectory}/dataset-version.json`)
  const manifestPath = await requireFile(`${release}/manifest.json`)
  const deliveryPath = await requireFile(`${release}/delivery-manifest.json`)
  const sample = delivery.product === 'preview' ? 'mobile' : 'desktop'
  await requireFile(`${release}/catalog-sample-${sample}.json.gz`)
  await requireFile(`${release}/catalog-sample-${sample}.bin`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!manifest.capabilities?.includes('gzip-json-v1')) throw new Error('Deployable dataset manifest does not declare gzip-json-v1')
  if (await exists(join(dist, ...`${release}/catalog-sample-${sample}.json`.split('/')))) {
    throw new Error('Deployable artifact unexpectedly contains the uncompressed sample JSON')
  }
  if (delivery.product === 'preview') {
    const expected = previewDatasetPlan(manifest, delivery.availabilitySha256)
    if (JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) throw new Error('Preview manifest advertises unavailable resources')
    const files = expected.sourcePaths.map(path => path === 'catalog-sample-mobile.json' ? `${path}.gz` : path).sort()
    const actual = (await readdir(join(dist, release))).sort()
    if (JSON.stringify(actual) !== JSON.stringify([...files, 'delivery-manifest.json'].sort())) throw new Error('Unexpected preview dataset files')
    // Reject legacy full assets anywhere in this artifact, not just this release.
    if (JSON.stringify((await readdir(join(dist, 'data/asteroids'))).sort()) !== '["preview"]') throw new Error('Full dataset leaked into preview delivery')
    if (JSON.stringify(await readdir(join(dist, 'data/asteroids/preview'))) !== JSON.stringify([delivery.availabilitySha256])) throw new Error('Unexpected preview namespace')
    const deliveredText = await readFile(deliveryPath, 'utf8')
    if (sha256(deliveredText) !== health.dataset.deliveryManifestSha256) throw new Error('Dataset delivery manifest hash mismatch')
    const delivered = JSON.parse(deliveredText)
    if (delivered.delivery?.profile !== 'preview' || delivered.delivery?.availabilitySha256 !== delivery.availabilitySha256
      || delivered.sourceContentSha256 !== manifest.contentSha256) throw new Error('Dataset delivery provenance mismatch')
    if (JSON.stringify(delivered.files.map(file => file.path).sort()) !== JSON.stringify(files)
      || sha256(JSON.stringify(delivered.files)) !== delivered.deliveredContentSha256) throw new Error('Dataset delivery file identity mismatch')
    for (const file of delivered.files) {
      const bytes = await readFile(join(dist, release, file.path))
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Preview dataset checksum mismatch: ${file.path}`)
    }
  }
}

process.stdout.write('Build artifact contract verified.\n')
