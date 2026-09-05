import { readStateTileJson, validateStateTileManifest } from './stateTiles'
import type { StateTileManifest } from './stateTiles'

const TIME_SCALE = 'TDB seconds past J2000'
const MAX_SUMMARY_BYTES = 64 * 1024
type ObjectValue = Record<string, unknown>
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid coverage object')
  return value as ObjectValue
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid coverage count')
  return value
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid coverage epoch')
  return value
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid coverage hash')
  return value
}

/** An audit of a pinned source population, never the current rendered frame. */
export function validateCoverageReport(raw: unknown, manifest: StateTileManifest) {
  const value = object(raw)
  if (value.apiVersion !== 'solar.api/v1' || value.purpose !== 'source-identity-and-dependency-window-audit'
    || value.profile !== 'full' || value.sourceBytesVerified !== true
    || value.timeScale !== TIME_SCALE || value.frame !== 'ECLIPJ2000') throw new Error('Invalid coverage contract')
  const catalogManifestSha256 = hash(value.catalogManifestSha256)
  const inventoryManifestSha256 = hash(value.inventoryManifestSha256)
  if (value.catalogVersion !== manifest.catalogVersion || catalogManifestSha256 !== manifest.catalogManifestSha256
    || inventoryManifestSha256 !== manifest.inventoryManifestSha256) throw new Error('Coverage dataset mismatch')
  const inputCounts = object(value.counts)
  const counts = {
    sourceRecords: count(inputCounts.sourceRecords),
    mappedSourceRecords: count(inputCounts.mappedSourceRecords),
    unresolvedSourceRecords: count(inputCounts.unresolvedSourceRecords),
    explicitNaifTargets: count(inputCounts.explicitNaifTargets),
    availableTargetsAtAuditEpoch: count(inputCounts.availableTargetsAtAuditEpoch),
  }
  if (counts.mappedSourceRecords > counts.sourceRecords || counts.unresolvedSourceRecords !== counts.sourceRecords - counts.mappedSourceRecords
    || counts.explicitNaifTargets > counts.mappedSourceRecords || counts.availableTargetsAtAuditEpoch > counts.explicitNaifTargets) throw new Error('Inconsistent coverage counts')
  const inputWindows = object(value.windowCounts)
  const windowCounts = {
    dependencyCoveredTargets: count(inputWindows.dependencyCoveredTargets),
    targetsWithDependencyGaps: count(inputWindows.targetsWithDependencyGaps),
    numericallyCertifiedWholeWindowTargets: null,
  }
  if (inputWindows.numericallyCertifiedWholeWindowTargets !== null
    || windowCounts.dependencyCoveredTargets > counts.explicitNaifTargets
    || windowCounts.targetsWithDependencyGaps !== counts.explicitNaifTargets - windowCounts.dependencyCoveredTargets) throw new Error('Invalid coverage window counts')
  const reasons = Object.entries(object(value.unresolvedReasons))
  if (reasons.length > 128) throw new Error('Too many coverage reasons')
  const unresolvedReasons = reasons.map(([reason, total]) => {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(reason)) throw new Error('Invalid coverage reason')
    return { reason, count: count(total) }
  }).sort((a, b) => a.reason.localeCompare(b.reason))
  let remaining = counts.unresolvedSourceRecords
  for (const entry of unresolvedReasons) {
    if (entry.count > remaining) throw new Error('Inconsistent coverage reasons')
    remaining -= entry.count
  }
  if (remaining !== 0) throw new Error('Incomplete coverage reasons')
  const inputWindow = object(value.requestedWindow)
  const requestedWindow = { startEt: finite(inputWindow.startEt), endEt: finite(inputWindow.endEt), timeScale: TIME_SCALE }
  if (inputWindow.timeScale !== TIME_SCALE || requestedWindow.startEt > requestedWindow.endEt) throw new Error('Invalid coverage window')
  // The independent audit epoch need not be inside the requested window.
  return {
    catalogVersion: manifest.catalogVersion, catalogManifestSha256, inventoryManifestSha256,
    reportSha256: hash(value.reportSha256), sourceSnapshotSha256: hash(value.sourceSnapshotSha256),
    identityMappingSha256: hash(value.identityMappingSha256), satelliteCatalogSha256: hash(value.satelliteCatalogSha256),
    auditEt: finite(value.auditEt), timeScale: TIME_SCALE, frame: 'ECLIPJ2000',
    requestedWindow, counts, windowCounts, unresolvedReasons,
  }
}

export type CoverageReport = ReturnType<typeof validateCoverageReport>
export class CoverageUnavailableError extends Error {}

export async function loadCoverageReport(baseUrl: string | null, profile: 'full' | 'preview', signal: AbortSignal): Promise<CoverageReport> {
  // Product restriction is enforced before any network request, even if a
  // preview build accidentally receives a full-backend environment variable.
  if (profile !== 'full' || !baseUrl?.trim()) throw new CoverageUnavailableError('Coverage requires a configured full backend')
  const base = baseUrl.trim().replace(/\/+$/, '')
  const manifest = validateStateTileManifest(await readStateTileJson(await fetch(`${base}/v1/catalog/manifest`, { signal, cache: 'no-store' }), 'Coverage manifest'))
  const response = await fetch(`${base}/v1/coverage`, { signal, cache: 'no-store' })
  if (response.status === 404) { await response.body?.cancel(); throw new CoverageUnavailableError('Coverage report is not configured') }
  const length = Number(response.headers.get('content-length'))
  if (!response.headers.has('content-length') || !Number.isSafeInteger(length) || length < 1 || length > MAX_SUMMARY_BYTES) {
    await response.body?.cancel()
    throw new Error('Coverage summary exceeds its size contract')
  }
  return validateCoverageReport(await readStateTileJson(response, 'Coverage summary'), manifest)
}
