import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { installApproximationArchive, packApproximationArchive } from '../../scripts/lib/approximation-archive.mjs'

const temporary: string[] = []
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    if (!resolve(path).startsWith(`${resolve(tmpdir())}${sep}solar-approximation-archive-`)) throw new Error('Fixture cleanup escaped the temporary directory')
    await rm(path, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'solar-approximation-archive-')); temporary.push(root)
  const source = join(root, 'source'), destination = join(root, 'installed'), archive = join(root, 'archive.gz')
  await mkdir(join(source, 'chunks'), { recursive: true })
  const sourceManifestSha256 = digest(await readFile('src/data/ephemeris-manifest-full.json'))
  const raw = JSON.stringify({ schemaVersion: 1, id: 'earth', parentId: 'sun', sourceManifestSha256,
    sourceKernelHashes: ['a'.repeat(64)], segments: [{ startEt: 0, endEt: 1, coefficients: Array.from({ length: 3 }, () => Array(9).fill(0)), sampledPositionErrorKm: 0, sampledVelocityErrorKmS: 0 }] })
  const manifest = { schemaVersion: 1, model: 'piecewise-chebyshev-best-sampled-v1', sourceManifestSha256,
    totalBytes: Buffer.byteLength(raw), bodies: [{ id: 'earth', parentId: 'sun', chunks: [{ path: 'chunks/earth.json', bytes: Buffer.byteLength(raw), sha256: digest(raw), segmentCount: 1 }] }] }
  await writeFile(join(source, 'chunks/earth.json'), raw)
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  return { source, destination, archive, manifest, raw }
}
it('packages only admitted files and restores their exact bytes through the build archive entrypoint', async () => {
  const { source, destination, archive, raw } = await fixture()
  await writeFile(join(source, 'chunks/unreferenced.json'), 'unrelated')
  const receipt = await packApproximationArchive(source, archive)
  await installApproximationArchive(archive, receipt.sha256, destination)
  expect(await readFile(join(destination, 'chunks/earth.json'), 'utf8')).toBe(raw)
  await expect(readFile(join(destination, 'chunks/unreferenced.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('rejects an unpinned archive before publishing a manifest', async () => {
  const { source, destination, archive } = await fixture()
  await packApproximationArchive(source, archive)
  await expect(installApproximationArchive(archive, '0'.repeat(64), destination)).rejects.toThrow('SHA-256 mismatch')
  await expect(readFile(join(destination, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('rejects traversal descriptors and truncated gzip input without publishing coverage', async () => {
  const { destination, archive, manifest, raw } = await fixture()
  manifest.bodies[0].chunks[0].path = '../escape.json'
  const bytes = gzipSync(`${JSON.stringify({ format: 'solar-approximation-archive-v1', manifest })}\n`)
  await writeFile(archive, bytes)
  await expect(installApproximationArchive(archive, digest(bytes), destination)).rejects.toThrow('Unsafe')
  manifest.bodies[0].chunks[0].path = 'chunks/earth.json'
  const valid = gzipSync(`${JSON.stringify({ format: 'solar-approximation-archive-v1', manifest })}\n${JSON.stringify({ path: 'chunks/earth.json', data: Buffer.from(raw).toString('base64') })}\n`)
  const truncated = valid.subarray(0, valid.length - 6)
  await writeFile(archive, truncated)
  await expect(installApproximationArchive(archive, digest(truncated), destination)).rejects.toThrow()
  await expect(readFile(join(destination, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
