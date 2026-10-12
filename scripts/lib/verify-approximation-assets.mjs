import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { decodeApproximationBinary } from '../../src/engine/ephemeris/approximationBinary.ts'
import { propagateTwoBody } from '../../src/engine/ephemeris/twoBodyForecast.ts'

export async function verifyApproximationAssets(root) {
  const manifestBytes = await readFile(join(root, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  let compressedManifestBytes = 0
  try {
    const packed = await readFile(join(root, 'manifest.json.gz'))
    if (!gunzipSync(packed, { maxOutputLength: 16 * 1048576 }).equals(manifestBytes)) throw new Error('Compressed approximation manifest mismatch')
    compressedManifestBytes = packed.byteLength
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  let indexedManifestBytes = 0
  let bodyIndexBytes = 0
  const indexPaths = new Set()
  const indexBytes = await readFile(join(root, 'index.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (indexBytes) {
    const index = JSON.parse(indexBytes)
    const digest = createHash('sha256').update(manifestBytes).digest('hex')
    if (!/^[a-f0-9]{64}$/.test(index.sha256) || index.path !== `manifests/${index.sha256}.json.gz`
      || !Number.isSafeInteger(index.bytes) || index.bytes <= 0 || index.bytes > 16 * 1048576) throw new Error('Invalid approximation delivery index')
    const packed = await readFile(join(root, index.path))
    const raw = gunzipSync(packed, { maxOutputLength: index.bytes })
    if (raw.length !== index.bytes || createHash('sha256').update(raw).digest('hex') !== index.sha256) throw new Error('Indexed approximation manifest checksum mismatch')
    if (index.layout === 'body-indexed-v1') {
      const browser = JSON.parse(raw)
      if (browser.sourceManifestSha256 !== manifest.sourceManifestSha256 || browser.bodies.length !== manifest.bodies.length) throw new Error('Indexed approximation source identity mismatch')
      for (let number = 0; number < manifest.bodies.length; number++) {
        const body = browser.bodies[number], expected = manifest.bodies[number]
        if (body.index) {
          const descriptor = body.index
          if (descriptor.path !== `indices/${descriptor.sha256}.json.gz` || !/^[a-f0-9]{64}$/.test(descriptor.sha256)
            || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || descriptor.bytes > 2 * 1048576 || indexPaths.has(descriptor.path)) throw new Error('Invalid body index path or size')
          const compressed = await readFile(join(root, descriptor.path)), data = gunzipSync(compressed, { maxOutputLength: descriptor.bytes })
          if (data.length !== descriptor.bytes || createHash('sha256').update(data).digest('hex') !== descriptor.sha256) throw new Error('Body index checksum mismatch')
          const document = JSON.parse(data)
          if (document.schemaVersion !== 1 || document.id !== expected.id || document.parentId !== expected.parentId
            || document.sourceManifestSha256 !== manifest.sourceManifestSha256 || JSON.stringify(document.chunks) !== JSON.stringify(expected.chunks)
            || JSON.stringify(descriptor.windows) !== JSON.stringify(expected.chunks.map(chunk => [chunk.startEt, chunk.endEt]))) throw new Error('Body index descriptors differ from full receipt')
          body.chunks = document.chunks; delete body.index
          bodyIndexBytes += compressed.length; indexPaths.add(descriptor.path)
        }
        if (JSON.stringify(body) !== JSON.stringify(expected)) throw new Error('Indexed body metadata differs from full receipt')
      }
      if (JSON.stringify(browser) !== JSON.stringify(manifest)) throw new Error('Indexed global metadata differs from full receipt')
    } else if (index.sha256 !== digest || !raw.equals(manifestBytes)) throw new Error('Indexed approximation manifest mismatch')
    indexedManifestBytes = indexBytes.byteLength + packed.byteLength
  }
  const sourcePath = manifest.sourceManifestPath ?? 'src/data/ephemeris-manifest-full.json'
  if (!['src/data/ephemeris-manifest-full.json', 'src/data/ephemeris-manifest-vercel-wide.json'].includes(sourcePath)) throw new Error('Unpinned approximation source manifest')
  const source = await readFile(sourcePath)
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  if (manifest.schemaVersion !== 1 || manifest.model !== 'piecewise-chebyshev-best-sampled-v1'
    || manifest.sourceManifestSha256 !== hash(source) || !Array.isArray(manifest.bodies)) throw new Error('Invalid approximation source identity')
  let bytes = 0, packagedBytes = 0
  const paths = new Set(['manifest.json', ...indexPaths])
  for (const body of manifest.bodies) {
    let end = -Infinity
    for (const forecast of body.forecasts ?? []) {
      if (forecast.model !== 'two-body-universal' || forecast.uncertainty !== 'unknown-outside-source-coverage'
        || ![forecast.startEt, forecast.endEt, forecast.seedEt, forecast.gmKm3S2].every(Number.isFinite)
        || forecast.startEt < end || forecast.endEt <= forecast.startEt || forecast.gmKm3S2 <= 0
        || !forecast.parameterSource || !forecast.sourceHashes?.length || forecast.sourceHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))
        || !forecast.sourceUrls?.length || forecast.sourceUrls.some(url => !/^https:\/\//.test(url))
        || !['source-fit', 'horizons-vector'].includes(forecast.anchorSource)
        || !Number.isSafeInteger(forecast.backtest?.samples) || forecast.backtest.samples < 0
        || !Number.isFinite(forecast.backtest.maximumOffsetDays) || forecast.backtest.maximumOffsetDays < 0
        || [forecast.backtest.maximumPositionErrorKm, forecast.backtest.maximumVelocityErrorKmS].some(error => error !== null && (!Number.isFinite(error) || error < 0))) throw new Error(`Invalid forecast evidence: ${body.id}`)
      if (body.chunks.some(chunk => forecast.startEt < chunk.endEt && forecast.endEt > chunk.startEt)) throw new Error(`Forecast overlaps source: ${body.id}`)
      for (const et of [forecast.startEt, (forecast.startEt + forecast.endEt) / 2, forecast.endEt]) propagateTwoBody(forecast.seed, forecast.gmKm3S2, et - forecast.seedEt)
      end = forecast.endEt
    }
  }
  for (const body of manifest.bodies) for (const chunk of body.chunks) {
    if (!/^chunks\/[a-zA-Z0-9:%._-]+\.(?:json|bin)(?:\.gz)?$/.test(chunk.path) || paths.has(chunk.path)) throw new Error('Unsafe or duplicate approximation path')
    if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > 16 * 1048576) throw new Error('Invalid approximation byte limit')
    const packed = await readFile(join(root, chunk.path))
    const raw = chunk.path.endsWith('.gz') ? gunzipSync(packed, { maxOutputLength: chunk.bytes }) : packed
    if (raw.byteLength !== chunk.bytes || hash(raw) !== chunk.sha256) throw new Error(`Approximation checksum mismatch: ${chunk.path}`)
    const document = chunk.encoding === 'binary-chebyshev-v1' ? decodeApproximationBinary(raw) : JSON.parse(raw)
    if (document.id !== body.id || document.parentId !== body.parentId || document.sourceManifestSha256 !== manifest.sourceManifestSha256
      || document.segments.length !== chunk.segmentCount) throw new Error(`Approximation chunk identity mismatch: ${chunk.path}`)
    paths.add(chunk.path); bytes += raw.byteLength; packagedBytes += packed.byteLength
  }
  if (bytes !== manifest.totalBytes) throw new Error('Approximation byte total mismatch')
  return { manifest, paths, bytes: packagedBytes + manifestBytes.byteLength + compressedManifestBytes + indexedManifestBytes + bodyIndexBytes }
}
