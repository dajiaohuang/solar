import { expect, it } from 'vitest'
import { splitApproximationDocument, packageApproximation } from '../../scripts/lib/package-approximation.mjs'
import { verifyApproximationAssets } from '../../scripts/lib/verify-approximation-assets.mjs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { datasetVersionFromUrl, isObsoleteDatasetVersion } from '../../src/data/cache/indexedDb'

it('splits delivery units without changing scientific coefficients, boundaries or identity', () => {
  const segments = Array.from({ length: 20 }, (_, i) => ({ startEt: i, endEt: i + 1,
    coefficients: [[i, ...Array(16).fill(Math.PI)], Array(17).fill(0), Array(17).fill(0)],
    sampledPositionErrorKm: 1, sampledVelocityErrorKmS: .001 }))
  const source = { id: 'earth', parentId: 'sun', sourceManifestSha256: 'a'.repeat(64), segments }
  const groups = splitApproximationDocument(source, 2000)
  expect(groups.length).toBeGreaterThan(1)
  expect(groups.flatMap(group => group.segments)).toEqual(segments)
  for (const group of groups) {
    expect(group.id).toBe('earth')
    expect(group.sourceManifestSha256).toBe(source.sourceManifestSha256)
    expect(Buffer.byteLength(JSON.stringify(group))).toBeLessThanOrEqual(2000)
  }
})

it('keeps content-addressed coefficients when a catalog release changes', () => {
  expect(datasetVersionFromUrl('/data/approximation/chunks/earth-abcdef.json.gz')).toBe('approximation')
  expect(isObsoleteDatasetVersion('approximation', 'mpcorb-new')).toBe(false)
  expect(isObsoleteDatasetVersion('mpcorb-current', 'approximation')).toBe(false)
  expect(isObsoleteDatasetVersion('mpcorb-old', 'mpcorb-new')).toBe(true)
})

it('verifies the packaged bulk index against the full receipt, including hash-valid mutations', async () => {
  const base = resolve('.cache'), hash = (raw: Uint8Array | string) => createHash('sha256').update(raw).digest('hex')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'delivery-check-'))
  if (dirname(root) !== base) throw new Error('Unexpected test workspace')
  try {
    const destination = join(root, 'output'), sourceManifestPath = 'src/data/ephemeris-manifest-vercel-wide.json'
    const manifest = { schemaVersion: 1, model: 'piecewise-chebyshev-best-sampled-v1', sourceManifestPath,
      sourceManifestSha256: hash(await readFile(sourceManifestPath)), totalBytes: 0,
      bodies: [{ id: 'sun', parentId: 'sun', origin: true, available: true, seedModel: false, chunks: [] }] }
    await packageApproximation(root, destination, manifest)
    await expect(verifyApproximationAssets(destination)).resolves.toMatchObject({ manifest: { totalBytes: 0 } })
    const pointer = JSON.parse(await readFile(join(destination, 'index.json'), 'utf8'))
    const browser = JSON.parse(gunzipSync(await readFile(join(destination, pointer.path))).toString())
    const changed = JSON.stringify({ ...JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8')), totalBytes: 1 })
    const sha256 = hash(changed), path = `indices/${sha256}.json.gz`
    await writeFile(join(destination, path), gzipSync(changed))
    browser.bulkIndex = { path, sha256, bytes: Buffer.byteLength(changed) }
    const raw = JSON.stringify(browser), manifestHash = hash(raw), manifestPath = `manifests/${manifestHash}.json.gz`
    await writeFile(join(destination, manifestPath), gzipSync(raw))
    await writeFile(join(destination, 'index.json'), JSON.stringify({ ...pointer, path: manifestPath, sha256: manifestHash, bytes: Buffer.byteLength(raw) }))
    await expect(verifyApproximationAssets(destination)).rejects.toThrow('Bulk index differs from full receipt')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
