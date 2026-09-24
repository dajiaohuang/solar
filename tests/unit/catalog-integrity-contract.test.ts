import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import type { AsteroidIndexEntry, AsteroidManifest, AsteroidRecord, CatalogSummary } from '../../src/types'
import { bindCatalogChecksums } from '../../src/lib/catalogIntegrity'
import { bindCatalogIndexRecord, validateCatalogMetadata, validateCatalogRecords } from '../../src/lib/catalogRecordValidation'
import { bindCatalogSummary } from '../../src/lib/catalogSummary'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const sourceHash = digest('source bytes')
const manifest = { totalCount: 1, datasetMode: 'full', sourceSha256: sourceHash, categoryCounts: { MBA: 1 } } as AsteroidManifest
const row: AsteroidIndexEntry = {
  id: 'asteroid:mpc:00001', packedDesignation: '00001', permanentNumber: 1,
  label: '1 Ceres', shortLabel: 'Ceres', searchKey: 'ceres 1 00001',
  chunkId: 'chunk-0000', chunkIndex: 0, rowIndex: 0,
  orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', isNeo: false, isPha: false,
}

it('binds the descriptor identity and refuses changed or undeclared source artifacts', async () => {
  const files = { 'binary/chunk-0000.bin': digest('orbit bytes'), 'meta/chunk-0000.json': digest(JSON.stringify([row])) }
  const boundManifest = { ...manifest, contentSha256: digest(JSON.stringify(files)) }
  const signal = new AbortController().signal
  const checksums = await bindCatalogChecksums({ schemaVersion: 1, algorithm: 'sha256', files }, boundManifest, signal)
  expect(checksums('meta/chunk-0000.json')).toBe(files['meta/chunk-0000.json'])
  expect(checksums.has('binary/chunk-0001.bin')).toBe(false)
  expect(() => checksums('binary/chunk-0001.bin')).toThrow('Missing content-bound')
  files['meta/chunk-0000.json'] = digest('changed labels')
  expect(checksums('meta/chunk-0000.json')).toBe(digest(JSON.stringify([row])))
  await expect(bindCatalogChecksums({ schemaVersion: 1, algorithm: 'sha256', files }, boundManifest, signal)).rejects.toThrow('content identity')
})

it('honors cancellation before descriptor validation', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(bindCatalogChecksums(null, manifest, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('refuses duplicate identities, displaced source rows and altered index labels', () => {
  validateCatalogMetadata([row], 'chunk-0000')
  expect(() => validateCatalogMetadata([row, { ...row, rowIndex: 1 }], 'chunk-0000')).toThrow('Duplicate')
  expect(() => validateCatalogMetadata([{ ...row, rowIndex: 1 }], 'chunk-0000')).toThrow('locator')
  expect(() => validateCatalogMetadata([{ ...row, chunkIndex: 1 }], 'chunk-0000')).toThrow('locator')
  expect(() => bindCatalogIndexRecord({ ...row, label: 'another body' }, row, 0)).toThrow('differs')
  expect(() => bindCatalogIndexRecord(row, undefined, 0)).toThrow('missing')
  expect(bindCatalogIndexRecord({ ...row }, row, 0)).toBe(row)
})

it('rejects non-elliptic or non-finite rows from the elliptic catalog path', () => {
  const record: AsteroidRecord = { ...row, epochJd: 2451545, semiMajorAxisAU: 2.7,
    eccentricity: 0.1, inclinationDeg: 10, ascendingNodeDeg: 20,
    argPeriapsisDeg: 30, meanAnomalyDeg: 40, meanMotionDegPerDay: 0.2 }
  expect(validateCatalogRecords([record], 'chunk-0000')).toEqual([record])
  for (const patch of [{ eccentricity: 1 }, { semiMajorAxisAU: -1 }, { meanMotionDegPerDay: 0 },
    { inclinationDeg: 181 }, { epochJd: NaN }]) {
    expect(() => validateCatalogRecords([{ ...record, ...patch }], 'chunk-0000')).toThrow('elliptic')
  }
})

it('binds summary coverage to the source and returns owned ranges', () => {
  const summary: CatalogSummary = { schemaVersion: 2, datasetMode: 'full', totalCount: 1,
    sourceSha256: sourceHash, categoryCounts: { MBA: 1 }, magnitudeKnownCount: 0, magnitudeUnknownCount: 1,
    numericRanges: { semiMajorAxisAU: [2.7, 2.7], eccentricity: [0.1, 0.1], inclinationDeg: [10, 10], epochJd: [2451545, 2451545] } }
  const bound = bindCatalogSummary(summary, manifest)
  summary.numericRanges.semiMajorAxisAU![0] = 99
  summary.categoryCounts.MBA = 99
  expect(bound.numericRanges.semiMajorAxisAU).toEqual([2.7, 2.7])
  expect(bound.categoryCounts).toEqual({ MBA: 1 })
  for (const patch of [{ magnitudeKnownCount: 1 }, { sourceSha256: digest('other source') },
    { categoryCounts: { APO: 1 } }, { numericRanges: { ...bound.numericRanges, eccentricity: [1, 1] as [number, number] } }]) {
    expect(() => bindCatalogSummary({ ...bound, ...patch }, manifest)).toThrow()
  }
})
