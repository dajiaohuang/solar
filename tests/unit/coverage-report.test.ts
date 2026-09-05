import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CoverageUnavailableError, loadCoverageReport, validateCoverageReport } from '../../src/lib/coverageReport'
import { validateStateTileManifest } from '../../src/lib/stateTiles'
import { coverageSummaryFixture } from '../fixtures/coverageReport'

const manifest = validateStateTileManifest(coverageSummaryFixture())
function json(value: unknown) {
  const body = JSON.stringify(value)
  return new Response(body, { headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length) } })
}
afterEach(() => vi.unstubAllGlobals())

const fixtureDirectory = process.env.SOLAR_COVERAGE_FIXTURE_DIR
it.skipIf(!fixtureDirectory)('validates retained real Go coverage HTTP responses using the production decoder', () => {
  const manifest = validateStateTileManifest(JSON.parse(readFileSync(join(fixtureDirectory!, 'manifest.json'), 'utf8')))
  const raw = JSON.parse(readFileSync(join(fixtureDirectory!, 'summary.json'), 'utf8'))
  const report = validateCoverageReport(raw, manifest)
  expect(report.counts.sourceRecords).toBeGreaterThan(0)
  expect(report.counts.explicitNaifTargets).toBeGreaterThan(0)
  expect(report.windowCounts.numericallyCertifiedWholeWindowTargets).toBeNull()
})

describe('pinned all-source coverage summary', () => {
  it('keeps source aliases, distinct targets and window availability separate', () => {
    const report = validateCoverageReport(coverageSummaryFixture(), manifest)
    expect(report.counts).toEqual({ sourceRecords: 10, mappedSourceRecords: 3, unresolvedSourceRecords: 7, explicitNaifTargets: 2, availableTargetsAtAuditEpoch: 2 })
    expect(report.windowCounts.numericallyCertifiedWholeWindowTargets).toBeNull()
  })
  it('allows an audit epoch outside the independently requested window', () => {
    const value = coverageSummaryFixture(); value.auditEt = 2000
    expect(validateCoverageReport(value, manifest).auditEt).toBe(2000)
  })
  it.each([
    ['catalogVersion', 'other'], ['catalogManifestSha256', '1'.repeat(64)],
    ['inventoryManifestSha256', '2'.repeat(64)], ['reportSha256', 'invalid'],
    ['sourceSnapshotSha256', null], ['identityMappingSha256', ''], ['satelliteCatalogSha256', false],
    ['profile', 'pages'], ['sourceBytesVerified', false], ['frame', 'J2000'],
    ['timeScale', 'UTC'], ['auditEt', Infinity], ['purpose', 'live-state'],
  ])('rejects a wrong identity or scientific contract: %s', (key, value) => {
    expect(() => validateCoverageReport({ ...coverageSummaryFixture(), [key]: value }, manifest)).toThrow()
  })
  it.each([
    { sourceRecords: 11 }, { mappedSourceRecords: -1 }, { unresolvedSourceRecords: 6 },
    { explicitNaifTargets: 4 }, { availableTargetsAtAuditEpoch: 3 }, { sourceRecords: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects inconsistent or unsafe totals %j', (counts) => {
    const value = coverageSummaryFixture()
    expect(() => validateCoverageReport({ ...value, counts: { ...value.counts, ...counts } }, manifest)).toThrow()
  })
  it('rejects missing inventory binding, unproved whole-window certification, gaps and reasons mismatch', () => {
    const value = coverageSummaryFixture()
    expect(() => validateCoverageReport(value, { ...manifest, inventoryManifestSha256: undefined })).toThrow()
    expect(() => validateCoverageReport({ ...value, windowCounts: { ...value.windowCounts, numericallyCertifiedWholeWindowTargets: 0 } }, manifest)).toThrow()
    expect(() => validateCoverageReport({ ...value, windowCounts: { ...value.windowCounts, targetsWithDependencyGaps: 0 } }, manifest)).toThrow()
    expect(() => validateCoverageReport({ ...value, unresolvedReasons: {} }, manifest)).toThrow()
    expect(() => validateCoverageReport({ ...value, unresolvedReasons: { missing: 8 } }, manifest)).toThrow()
    expect(() => validateCoverageReport({ ...value, requestedWindow: { ...value.requestedWindow, endEt: -1 } }, manifest)).toThrow()
  })
  it('refuses preview or unconfigured loads without making any request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    for (const [base, profile] of [['/api', 'preview'], [null, 'full']] as const) {
      await expect(loadCoverageReport(base, profile, new AbortController().signal)).rejects.toBeInstanceOf(CoverageUnavailableError)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('binds an on-demand response to a freshly fetched manifest with cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(manifest)).mockResolvedValueOnce(json(coverageSummaryFixture()))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    expect((await loadCoverageReport('/api/', 'full', signal)).counts.explicitNaifTargets).toBe(2)
    expect(fetcher.mock.calls).toEqual([
      ['/api/v1/catalog/manifest', { signal, cache: 'no-store' }], ['/api/v1/coverage', { signal, cache: 'no-store' }],
    ])
  })
  it('rejects unavailable, oversized and truncated responses without publishing a report', async () => {
    for (const response of [new Response(null, { status: 404 }), new Response('{}', { headers: { 'content-length': '65537' } }), new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '100' } })]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(manifest)).mockResolvedValueOnce(response))
      await expect(loadCoverageReport('/api', 'full', new AbortController().signal)).rejects.toThrow()
    }
  })
})
