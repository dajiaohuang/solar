import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

export async function verifyApproximationAssets(root) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
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
  return { manifest, paths, bytes: packagedBytes + (await readFile(join(root, 'manifest.json'))).byteLength }
}
