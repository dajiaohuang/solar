import { validateCoverageGaps } from './coverageGaps'
import { CoverageUnavailableError, type CoverageReport } from './coverageReport'
import { readStateTileJson } from './stateTiles'
import { ADVERTISED_QUEUE_RETRY, fetchRetryableResponse } from './retryableHttpResponse'

// Matches the coverage-target endpoint, independently of the report-file cap.
const MAX_TARGET_RESPONSE_BYTES = 16 * 1024 * 1024

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid target coverage record')
  return value as Record<string, unknown>
}

export async function loadCoverageTarget(baseUrl: string, profile: 'full' | 'preview', report: CoverageReport, id: string, signal: AbortSignal) {
  if (profile !== 'full' || !baseUrl.trim()) throw new CoverageUnavailableError('Target coverage requires a configured full backend')
  // Reject control characters as well as whitespace and list separators.
  // eslint-disable-next-line no-control-regex
  if (!id || id !== id.trim() || id.length > 512 || /[,\s\u0000-\u001f\u007f]/.test(id)) throw new Error('Enter one catalog identity or canonical naif:ID')
  signal.throwIfAborted()
  // Own the summary binding before a response can outlive caller changes.
  const expected = { reportSha256: report.reportSha256, catalogManifestSha256: report.catalogManifestSha256,
    inventoryManifestSha256: report.inventoryManifestSha256, auditEt: report.auditEt, timeScale: report.timeScale,
    frame: report.frame, requestedWindow: { ...report.requestedWindow } }
  const response = await fetchRetryableResponse(fetch, `${baseUrl.trim().replace(/\/+$/, '')}/v1/coverage/targets?${new URLSearchParams({ ids: id })}`, { signal, cache: 'no-store' }, signal, ADVERTISED_QUEUE_RETRY)
  const length = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_TARGET_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error('Target coverage exceeds the 16 MiB response limit')
  }
  const raw: unknown = await readStateTileJson(response, 'Target coverage', MAX_TARGET_RESPONSE_BYTES, signal)
  signal.throwIfAborted()
  const value = object(raw), window = object(value.requestedWindow)
  if (value.apiVersion !== 'solar.api/v1' || value.reportSha256 !== expected.reportSha256 ||
      value.catalogManifestSha256 !== expected.catalogManifestSha256 || value.inventoryManifestSha256 !== expected.inventoryManifestSha256 ||
      value.auditEt !== expected.auditEt || value.timeScale !== expected.timeScale || value.frame !== expected.frame ||
      window.startEt !== expected.requestedWindow.startEt || window.endEt !== expected.requestedWindow.endEt || window.timeScale !== expected.timeScale) {
    throw new Error('Target coverage differs from the loaded audit; reload the summary')
  }
  if (!Array.isArray(value.targets) || value.targets.length !== 1) throw new Error('Unexpected target coverage row count')
  const row = object(value.targets[0])
  if (row.requestedId !== id || !['audited', 'not_audited'].includes(String(row.status))) throw new Error('Target coverage identity mismatch')
  if (row.target !== undefined && (!Number.isSafeInteger(row.target) || row.canonicalId !== `naif:${row.target}`)) throw new Error('Invalid target coverage mapping')
  if (row.status === 'not_audited') {
    if (row.coverage !== undefined) throw new Error('Unaudited target unexpectedly has coverage')
    return { id, status: 'not_audited' as const, canonicalId: typeof row.canonicalId === 'string' ? row.canonicalId : null, raw }
  }
  const coverage = object(row.coverage), dependency = object(coverage.dependencyCoverage)
  if (!Number.isSafeInteger(row.target) || coverage.target !== row.target || coverage.key !== row.canonicalId ||
      !['state-available-at-audit-epoch', 'no-state-at-audit-epoch'].includes(String(coverage.stateAtAuditEpoch)) ||
      !Array.isArray(dependency.points) || !Array.isArray(dependency.intervals) || !Array.isArray(dependency.gaps)) throw new Error('Invalid audited target coverage')
  const gaps = validateCoverageGaps(dependency, expected.requestedWindow.startEt, expected.requestedWindow.endEt, row.target as number)
  return { id, status: 'audited' as const, canonicalId: String(row.canonicalId),
    availableAtAudit: coverage.stateAtAuditEpoch === 'state-available-at-audit-epoch', reportedGaps: gaps.length, gaps, raw }
}
