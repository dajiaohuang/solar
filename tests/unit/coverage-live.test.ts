import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadCoverageReport } from '../../src/lib/coverageReport'
import { readStateTileJson } from '../../src/lib/stateTiles'

// Read-only, explicitly configured real-process verification. Comparing the
// served ledger with its source report proves delivery fidelity, not astronomy.
const base = process.env.SOLAR_TEST_BACKEND_URL?.replace(/\/+$/, '')
const reportPath = process.env.SOLAR_COVERAGE_REPORT_PATH
type SourceRef = { id: string; ordinal: number; source: string; sourceRow: number }
type Group = { target: number; key: string; stateAtAuditEpoch: string; sourceRecords: SourceRef[] }
type Window = { target: number; dependencyCoverage: { points: unknown[]; intervals: unknown[] }; gaps: unknown[]; meaning: string }
type Report = {
  inputInventorySha256: string
  kernels: { manifestSha256: string; auditEt: number; timeScale: string; frame: string }
  requestedWindow: { startEt: number; endEt: number; timeScale: string }
  identity: { counts: Record<string, number>; explicitTargetGroups: Group[] }
  windows: Window[]
}
type TargetResponse = {
  reportSha256: string; catalogManifestSha256: string; inventoryManifestSha256: string
  auditEt: number; timeScale: string; frame: string; requestedWindow: Report['requestedWindow']
  targets: Array<{ requestedId: string; canonicalId?: string; target?: number; status: string; coverage?: unknown }>
}

function loopback() {
  if (!base || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new Error('Coverage integration requires an explicit loopback backend')
  return base
}
function pinnedReport() {
  if (!reportPath || statSync(reportPath).size > 8 * 1024 * 1024) throw new Error('Configure a bounded local coverage report')
  const bytes = readFileSync(reportPath)
  return { report: JSON.parse(bytes.toString('utf8')) as Report, sha256: createHash('sha256').update(bytes).digest('hex') }
}
async function targets(ids: string[]) {
  return await readStateTileJson(await fetch(`${loopback()}/v1/coverage/targets?${new URLSearchParams({ ids: ids.join(',') })}`, { signal: AbortSignal.timeout(30_000), cache: 'no-store' }), 'Coverage targets') as TargetResponse
}

describe.skipIf(!base || !reportPath)('live Go coverage delivery', () => {
  it('preserves every audited target, source reference, boundary, dependency and gap', async () => {
    const { report, sha256 } = pinnedReport()
    const summary = await loadCoverageReport(loopback(), 'full', AbortSignal.timeout(30_000))
    expect(summary.reportSha256).toBe(sha256)
    expect(summary.counts).toEqual(report.identity.counts)
    const groups = report.identity.explicitTargetGroups
    expect(groups.length).toBe(summary.counts.explicitNaifTargets)
    expect(groups.length).toBeGreaterThan(0)
    const windows = new Map(report.windows.map(window => [window.target, window]))
    let verified = 0
    for (let start = 0; start < groups.length; start += 64) {
      const batch = groups.slice(start, start + 64)
      const response = await targets(batch.map(group => group.key))
      expect(response.reportSha256).toBe(sha256)
      expect(response.catalogManifestSha256).toBe(report.kernels.manifestSha256)
      expect(response.inventoryManifestSha256).toBe(report.inputInventorySha256)
      expect(response.auditEt).toBe(report.kernels.auditEt)
      expect(response.timeScale).toBe(report.kernels.timeScale)
      expect(response.frame).toBe(report.kernels.frame)
      expect(response.requestedWindow).toEqual(report.requestedWindow)
      expect(response.targets).toHaveLength(batch.length)
      for (const [index, group] of batch.entries()) {
        const window = windows.get(group.target)
        expect(window).toBeDefined()
        expect(response.targets[index]).toEqual({
          requestedId: group.key, canonicalId: group.key, target: group.target, status: 'audited',
          coverage: {
            target: group.target, key: group.key, stateAtAuditEpoch: group.stateAtAuditEpoch,
            sourceRecords: group.sourceRecords.map(({ id, ordinal, source, sourceRow }) => ({ id, ordinal, source, sourceRow })),
            dependencyCoverage: { points: window!.dependencyCoverage.points, intervals: window!.dependencyCoverage.intervals, gaps: window!.gaps },
            meaning: window!.meaning,
          },
        })
        verified++
      }
    }
    expect(verified).toBe(summary.counts.explicitNaifTargets)
    // Repeating a read must not change stored evidence through shared buffers.
    const ids = groups.slice(0, 2).map(group => group.key)
    expect(await targets(ids)).toEqual(await targets(ids))
  }, 60_000)

  it('keeps unknown identities unaudited and enforces the query bound', async () => {
    const unknown = 'coverage-test:unknown'
    const response = await targets([unknown, unknown])
    expect(response.targets).toEqual([{ requestedId: unknown, status: 'not_audited' }])
    const ids = Array.from({ length: 65 }, (_, n) => `${unknown}:${n}`)
    const tooLarge = await fetch(`${loopback()}/v1/coverage/targets?${new URLSearchParams({ ids: ids.join(',') })}`, { signal: AbortSignal.timeout(30_000) })
    expect(tooLarge.status).toBe(400)
    expect(await tooLarge.json()).toMatchObject({ error: { code: 'coverage_query_too_large' } })
  })
})
