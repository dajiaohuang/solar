import { describe, expect, it } from 'vitest'
import { coveragePage, summarizeBackendCoverage } from '../../src/lib/backendCoverage'
import type { BackendFrame, StateTileAudit } from '../../src/lib/backendFrames'

function audit(bodyId: string, backendId = bodyId, missingReason = ''): StateTileAudit {
  return { bodyId, backendId, availability: missingReason ? 'missing' : 'operational', precision: missingReason ? 'unavailable' : 'exact',
    source: 'fixture', datasetVersion: 'fixture', model: 'spk-original', centerId: 'naif:0', stateEvidence: 'fixture', missingReason }
}
function frame(rows: StateTileAudit[]): BackendFrame {
  return { audit: rows, currentPositions: [], missingBodyIds: [], maxDistance: 0, absolutePositions: new Map(),
    catalogManifestSha256: 'a'.repeat(64), epochJd: 2451545, epochTdbJd: 2451545 }
}

describe('backend coverage populations', () => {
  it('separates selected rows from aliases and reference-only responses', () => {
    const result = summarizeBackendCoverage(['earth', 'earth', 'alias', 'moon', 'new'], frame([
      audit('earth', 'naif:399'), audit('alias', 'naif:399'), audit('moon', 'naif:301', 'kernel-coverage-gap'), audit('sun', 'naif:10'),
    ]))
    expect(result).toMatchObject({ selectedCount: 4, receivedCount: 3, uniqueRequestIdentities: 2, exactCount: 2, missingCount: 1, pendingCount: 1, projectedCount: 0,
      missingReasons: [['kernel-coverage-gap', 1]] })
    expect(result.rows.map(row => row.bodyId)).toEqual(['earth', 'alias', 'moon'])
  })
  it('does not call pending or failed responses explicit missing states', () => {
    expect(summarizeBackendCoverage(['moon'], null)).toMatchObject({ receivedCount: 0, exactCount: 0, missingCount: 0, pendingCount: 1 })
  })
  it('keeps exact states available when an unavailable reference prevents projection', () => {
    expect(summarizeBackendCoverage(['earth', 'mars'], frame([audit('earth'), audit('mars'), audit('reference', 'reference', 'unknown-identity')]))).toMatchObject({ exactCount: 2, missingCount: 0, projectedCount: 0 })
  })
  it('does not count an approximate row as exact or missing', () => {
    const row = { ...audit('asteroid'), availability: 'approximate', precision: 'approximate' }
    expect(summarizeBackendCoverage(['asteroid'], frame([row]))).toMatchObject({ receivedCount: 1, exactCount: 0, missingCount: 0 })
  })
  it('bounds evidence pages and clamps a retained page after selection shrinks', () => {
    const rows = Array.from({ length: 10001 }, (_, n) => n)
    expect(coveragePage(rows, 10).rows).toEqual(rows.slice(200, 220))
    expect(coveragePage([1, 2], 10)).toEqual({ page: 0, pages: 1, rows: [1, 2] })
    expect(coveragePage(rows, Infinity).rows).toEqual(rows.slice(0, 20))
  })
})
