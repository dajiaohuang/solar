import type { BackendFrame, StateTileAudit } from './backendFrames'
import type { BodyId } from '../types'

/** Selected entries, backend identities and reference-relative positions are
 * different populations. Never consult the local SPK registry for these counts. */
export function summarizeBackendCoverage(selectedIds: readonly BodyId[], frame?: BackendFrame | null) {
  const selected = new Set(selectedIds)
  const selectedCount = selected.size
  const projectedCount = new Set(frame?.currentPositions.filter(item => selected.has(item.body.id)).map(item => item.body.id)).size
  const rows: StateTileAudit[] = []
  const requestIds = new Set<string>()
  const reasons = new Map<string, number>()
  let exactCount = 0, missingCount = 0
  // Reuse the membership set as a seen set: no full second audit Map or
  // exact/missing object arrays need to survive a half-second frame refresh.
  for (const row of frame?.audit ?? []) {
    if (!selected.delete(row.bodyId)) continue
    rows.push(row)
    requestIds.add(row.backendId)
    if (row.precision === 'exact' && row.availability === 'operational') exactCount++
    if (row.availability === 'missing') {
      missingCount++
      const reason = row.missingReason || 'unspecified-missing-state'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
  }
  return {
    selectedCount,
    receivedCount: rows.length,
    uniqueRequestIdentities: requestIds.size,
    exactCount,
    missingCount,
    pendingCount: selected.size,
    projectedCount,
    missingReasons: [...reasons].sort(([a], [b]) => a.localeCompare(b)),
    rows,
  }
}

export const COVERAGE_PAGE_SIZE = 20
export function coveragePage<T>(rows: readonly T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / COVERAGE_PAGE_SIZE))
  const page = Math.min(pages - 1, Math.max(0, Number.isSafeInteger(requestedPage) ? requestedPage : 0))
  return { page, pages, rows: rows.slice(page * COVERAGE_PAGE_SIZE, (page + 1) * COVERAGE_PAGE_SIZE) }
}
