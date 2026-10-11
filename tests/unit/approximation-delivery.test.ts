import { expect, it } from 'vitest'
import { splitApproximationDocument } from '../../scripts/lib/package-approximation.mjs'
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
