import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

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
        const raw = Buffer.from(JSON.stringify(group))
        const sha256 = createHash('sha256').update(raw).digest('hex')
        const path = `chunks/${encodeURIComponent(body.id)}-${output.length}-${sha256.slice(0, 16)}.json.gz`
        const compressed = gzipSync(raw, { level: 9 })
        await writeFile(join(destinationRoot, path), compressed)
        maximumChunkBytes = Math.max(maximumChunkBytes, compressed.byteLength)
        output.push({ path, bytes: raw.byteLength, sha256, startEt: group.segments[0].startEt,
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
  const manifestSha256 = createHash('sha256').update(rawManifest).digest('hex')
  const path = `manifests/${manifestSha256}.json.gz`
  await mkdir(join(destinationRoot, 'manifests'), { recursive: true })
  await writeFile(join(destinationRoot, path), gzipSync(rawManifest, { level: 9 }))
  await writeFile(join(destinationRoot, 'index.json'), JSON.stringify({ path, bytes: Buffer.byteLength(rawManifest), sha256: manifestSha256 }))
}
