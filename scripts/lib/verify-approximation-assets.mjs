import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

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
  const indexBytes = await readFile(join(root, 'index.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (indexBytes) {
    const index = JSON.parse(indexBytes)
    const digest = createHash('sha256').update(manifestBytes).digest('hex')
    if (index.path !== `manifests/${digest}.json.gz` || index.sha256 !== digest || index.bytes !== manifestBytes.byteLength) throw new Error('Invalid approximation delivery index')
    const packed = await readFile(join(root, index.path))
    if (!gunzipSync(packed, { maxOutputLength: index.bytes }).equals(manifestBytes)) throw new Error('Indexed approximation manifest mismatch')
    indexedManifestBytes = indexBytes.byteLength + packed.byteLength
  }
  const source = await readFile('src/data/ephemeris-manifest-full.json')
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  if (manifest.schemaVersion !== 1 || manifest.model !== 'piecewise-chebyshev-best-sampled-v1'
    || manifest.sourceManifestSha256 !== hash(source) || !Array.isArray(manifest.bodies)) throw new Error('Invalid approximation source identity')
  let bytes = 0, packagedBytes = 0
  const paths = new Set(['manifest.json'])
  for (const body of manifest.bodies) for (const chunk of body.chunks) {
    if (!/^chunks\/[a-zA-Z0-9:%._-]+\.json(?:\.gz)?$/.test(chunk.path) || paths.has(chunk.path)) throw new Error('Unsafe or duplicate approximation path')
    if (!Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > 16 * 1048576) throw new Error('Invalid approximation byte limit')
    const packed = await readFile(join(root, chunk.path))
    const raw = chunk.path.endsWith('.gz') ? gunzipSync(packed, { maxOutputLength: chunk.bytes }) : packed
    if (raw.byteLength !== chunk.bytes || hash(raw) !== chunk.sha256) throw new Error(`Approximation checksum mismatch: ${chunk.path}`)
    const document = JSON.parse(raw)
    if (document.id !== body.id || document.parentId !== body.parentId || document.sourceManifestSha256 !== manifest.sourceManifestSha256
      || document.segments.length !== chunk.segmentCount) throw new Error(`Approximation chunk identity mismatch: ${chunk.path}`)
    paths.add(chunk.path); bytes += raw.byteLength; packagedBytes += packed.byteLength
  }
  if (bytes !== manifest.totalBytes) throw new Error('Approximation byte total mismatch')
  return { manifest, paths, bytes: packagedBytes + manifestBytes.byteLength + compressedManifestBytes + indexedManifestBytes }
}
