import type { BackendFrame, StateTileAudit } from './backendFrames'
import type { BodyId } from '../types'

export type IndexedEvidenceRows<T> = { readonly length: number; rowAt(index: number): T }

/** Selected entries, backend identities and reference-relative positions are
 * different populations. Never consult the local SPK registry for these counts. */
export function summarizeBackendCoverage(selectedIds: readonly BodyId[], frame?: BackendFrame | null) {
  const selected = new Set(selectedIds)
  const selectedCount = selected.size
  const projected = new Set<BodyId>()
  if (frame) for (let index = 0; index < frame.currentPositions.length; index++) {
    const id = frame.currentPositions.bodyAt(index).id
    if (selected.has(id)) projected.add(id)
  }
  const projectedCount = projected.size
  const evidence = frame?.evidence
  const ordinals = new Uint32Array(Math.min(selectedCount, evidence?.length ?? 0))
  const requestIds = new Set<string>()
  const reasons = new Map<string, number>()
  let exactCount = 0, missingCount = 0, receivedCount = 0
  // Reuse the membership set as a seen set: no full second audit Map or
  // exact/missing object arrays need to survive a half-second frame refresh.
  for (let index = 0; evidence && index < evidence.length; index++) {
    if (!selected.delete(evidence.bodyIdAt(index))) continue
    ordinals[receivedCount++] = index
    requestIds.add(evidence.backendIdAt(index))
    const status = evidence.statusAt(index)
    if (status === 'exact') exactCount++
    if (status === 'missing') {
      missingCount++
      const reason = evidence.missingReasonAt(index) || 'unspecified-missing-state'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
  }
  // Retain scalar source ordinals, not every materialized audit row. Only a
  // requested evidence page reads the original compact metadata columns.
  const rows: IndexedEvidenceRows<StateTileAudit> = { length: receivedCount, rowAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= receivedCount || !evidence) throw new RangeError('Coverage evidence ordinal is out of range')
    return evidence.rowAt(ordinals[index])
  } }
  return {
    selectedCount,
    receivedCount,
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
export function coveragePage<T>(rows: IndexedEvidenceRows<T>, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / COVERAGE_PAGE_SIZE))
  const page = Math.min(pages - 1, Math.max(0, Number.isSafeInteger(requestedPage) ? requestedPage : 0))
  const start = page * COVERAGE_PAGE_SIZE
  return { page, pages, rows: Array.from({ length: Math.min(COVERAGE_PAGE_SIZE, rows.length - start) }, (_, index) => rows.rowAt(start + index)) }
}
