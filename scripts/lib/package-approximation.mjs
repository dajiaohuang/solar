import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { encodeApproximationBinary } from '../../src/engine/ephemeris/approximationBinary.ts'

// Smaller delivery units reduce unused coefficients downloaded after a seek.
// Never alter a polynomial, its interval, units, or measured error receipts.
export const APPROXIMATION_CHUNK_TARGET_BYTES = 128 * 1024
export function splitApproximationDocument(document, targetBytes = APPROXIMATION_CHUNK_TARGET_BYTES) {
  const { segments, ...identity } = document
  const groups = [], overhead = Buffer.byteLength(JSON.stringify({ ...identity, segments: [] }))
  let group = [], bytes = overhead
  for (const segment of segments) {
    const size = Buffer.byteLength(JSON.stringify(segment)) + 1
    if (group.length && bytes + size > targetBytes) { groups.push({ ...identity, segments: group }); group = []; bytes = overhead }
    group.push(segment); bytes += size
  }
  if (group.length) groups.push({ ...identity, segments: group })
  return groups
}

export async function packageApproximation(sourceRoot, destinationRoot, manifest) {
  const packaged = structuredClone(manifest)
  packaged.totalBytes = 0
  let maximumChunkBytes = 0
  await mkdir(join(destinationRoot, 'chunks'), { recursive: true })
  for (const body of packaged.bodies) {
    const output = []
    for (const original of body.chunks) {
      const packed = await readFile(join(sourceRoot, original.path))
      const document = JSON.parse(original.path.endsWith('.gz') ? gunzipSync(packed, { maxOutputLength: original.bytes }) : packed)
      for (const group of splitApproximationDocument(document)) {
        const raw = Buffer.from(encodeApproximationBinary(group))
        const sha256 = createHash('sha256').update(raw).digest('hex')
        const path = `chunks/${encodeURIComponent(body.id)}-${output.length}-${sha256.slice(0, 16)}.bin.gz`
        const compressed = gzipSync(raw, { level: 9 })
        await writeFile(join(destinationRoot, path), compressed)
        maximumChunkBytes = Math.max(maximumChunkBytes, compressed.byteLength)
        output.push({ path, encoding: 'binary-chebyshev-v1', bytes: raw.byteLength, sha256, startEt: group.segments[0].startEt,
          endEt: group.segments.at(-1).endEt, segmentCount: group.segments.length,
          sampledPositionErrorKm: Math.max(...group.segments.map(segment => segment.sampledPositionErrorKm)),
          sampledVelocityErrorKmS: Math.max(...group.segments.map(segment => segment.sampledVelocityErrorKmS)) })
        packaged.totalBytes += raw.byteLength
      }
    }
    body.chunks = output
  }
  const rawManifest = JSON.stringify({ ...packaged, chunkCompression: 'gzip', deliveryChunkTargetBytes: APPROXIMATION_CHUNK_TARGET_BYTES, maximumCompressedChunkBytes: maximumChunkBytes })
  if (Buffer.byteLength(rawManifest) > 16 * 1048576) throw new Error('Packaged approximation manifest exceeds browser delivery budget')
  await writeFile(join(destinationRoot, 'manifest.json'), rawManifest)
  await writeFile(join(destinationRoot, 'manifest.json.gz'), gzipSync(rawManifest, { level: 9 }))
  // Keep the complete offline receipt, but visitors need descriptors only for
  // selected bodies. Forecast parameters and all identities stay in the root.
  const browserManifest = JSON.parse(rawManifest)
  await mkdir(join(destinationRoot, 'indices'), { recursive: true })
  // Large restored scenes amortize hundreds of index round trips. Small
  // selections retain individual indices and their original download budget.
  const bulkSha256 = createHash('sha256').update(rawManifest).digest('hex')
  const bulkPath = `indices/${bulkSha256}.json.gz`
  await writeFile(join(destinationRoot, bulkPath), gzipSync(rawManifest, { level: 9 }))
  browserManifest.bulkIndex = { path: bulkPath, sha256: bulkSha256, bytes: Buffer.byteLength(rawManifest) }
  for (const body of browserManifest.bodies) {
    if (!body.chunks.length) continue
    const raw = JSON.stringify({ schemaVersion: 1, id: body.id, parentId: body.parentId,
      sourceManifestSha256: browserManifest.sourceManifestSha256, chunks: body.chunks })
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const path = `indices/${sha256}.json.gz`
    await writeFile(join(destinationRoot, path), gzipSync(raw, { level: 9 }))
    body.index = { path, bytes: Buffer.byteLength(raw), sha256, windows: body.chunks.map(chunk => [chunk.startEt, chunk.endEt]) }
    body.chunks = []
  }
  const browserRaw = JSON.stringify(browserManifest)
  const manifestSha256 = createHash('sha256').update(browserRaw).digest('hex')
  const path = `manifests/${manifestSha256}.json.gz`
  await mkdir(join(destinationRoot, 'manifests'), { recursive: true })
  await writeFile(join(destinationRoot, path), gzipSync(browserRaw, { level: 9 }))
  await writeFile(join(destinationRoot, 'index.json'), JSON.stringify({ layout: 'body-indexed-v1', path, bytes: Buffer.byteLength(browserRaw), sha256: manifestSha256 }))
}
