import { loadGroundPayload, type GroundObservation, type GroundStation } from './groundObservation'
import { STATE_TILE_API_VERSION } from './stateTiles'

export type GroundVisibilityRequest = { startUtc: string; endUtc: string; station: GroundStation; bodyId: string; minAltitudeDeg: number; maxSunAltitudeDeg?: number }
export type GroundWindow = { startUtc: string; endUtc: string; startSeconds: number; endSeconds: number; durationSeconds: number; startBoundary: string; endBoundary: string }
export type GroundCrossing = { kind: 'rise' | 'set' | 'darkness-begins' | 'darkness-ends'; utc: string; seconds: number; lowerUtc: string; upperUtc: string; bracketSeconds: number }
export type GroundVisibility = Pick<GroundObservation, 'apiVersion' | 'catalogVersion' | 'catalogManifestSha256' | 'earthOrientation'> & {
  result: {
    model: string; request: GroundVisibilityRequest; durationSeconds: number; coverage: 'sampled-complete' | 'partial' | 'unavailable'
    windows: GroundWindow[]; crossings: GroundCrossing[]; missing: (GroundWindow & { reason: string })[]; evaluations: number
    sources: GroundObservation['result']['sources']; warnings: string[]; contract: Record<string, unknown>
  }
}
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid visibility response'); return value as Record<string, unknown> }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const utc = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value) // Includes a UTC leap second.

export function validateGroundVisibility(raw: unknown, request: GroundVisibilityRequest): GroundVisibility {
  const value = object(raw), r = object(value.result), echoed = object(r.request), station = object(echoed.station), eop = object(value.earthOrientation), contract = object(r.contract)
  const reject = () => { throw new Error('Visibility identity or scientific contract mismatch') }
  if (value.apiVersion !== STATE_TILE_API_VERSION || typeof value.catalogVersion !== 'string' || !hash(value.catalogManifestSha256)
    || !hash(eop.sha256) || eop.sourceUrl !== 'https://data.iers.org/products/eop/rapid/standard/finals2000A.all' || typeof eop.retrievedAt !== 'string' || !Number.isFinite(Date.parse(eop.retrievedAt))
    || r.model !== 'earth-station-airless-windows-v1' || echoed.bodyId !== request.bodyId || echoed.startUtc !== request.startUtc || echoed.endUtc !== request.endUtc || echoed.minAltitudeDeg !== request.minAltitudeDeg
    || (echoed.maxSunAltitudeDeg ?? undefined) !== request.maxSunAltitudeDeg || Object.entries(request.station).some(([key, expected]) => station[key] !== expected)
    || !finite(r.durationSeconds) || r.durationSeconds < 1 || r.durationSeconds > 86401 || !finite(r.evaluations) || !Number.isInteger(r.evaluations) || r.evaluations < 1 || r.evaluations > 8192
    || !['sampled-complete', 'partial', 'unavailable'].includes(r.coverage as string)
    || contract.observationModel !== 'earth-station-iau2006-2000a-spk-v1' || contract.direction !== 'apparent-airless-target-center' || contract.timeAxis !== 'TAI-elapsed-SI-seconds'
    || contract.angleUnit !== 'deg' || contract.stationDatum !== 'WGS84-ellipsoidal-height' || contract.physicalUncertainty !== 'not-propagated' || contract.continuousCoverageProven !== false
    || contract.stepSeconds !== 30 || contract.boundaryToleranceSeconds !== 0.25 || contract.maxEvaluations !== 8192
    || !Array.isArray(r.windows) || !Array.isArray(r.crossings) || !Array.isArray(r.missing) || !Array.isArray(r.sources) || !Array.isArray(r.warnings) || !r.warnings.every(w => typeof w === 'string')) reject()
  const duration = r.durationSeconds as number
  const windows = r.windows as unknown[], gaps = r.missing as unknown[], crossings = r.crossings as unknown[], sources = r.sources as unknown[]
  if (windows.length > 8192 || gaps.length > 8192 || crossings.length > 8192 || sources.length > 4 || (r.coverage === 'sampled-complete' && (gaps.length || sources.length < 2)) || (r.coverage !== 'sampled-complete' && !gaps.length) || (r.coverage === 'unavailable' && windows.length)) reject()
  const checkIntervals = (items: unknown[], missing: boolean) => {
    let previous = 0
    for (const item of items) {
      const v = object(item)
      if (!utc(v.startUtc) || !utc(v.endUtc) || !finite(v.startSeconds) || !finite(v.endSeconds) || !finite(v.durationSeconds) || v.startSeconds < previous || v.endSeconds <= v.startSeconds || v.endSeconds > duration
        || Math.abs(v.durationSeconds - (v.endSeconds - v.startSeconds)) > 1e-6 || !['search-boundary', 'coverage-gap', 'threshold'].includes(v.startBoundary as string) || !['search-boundary', 'coverage-gap', 'threshold'].includes(v.endBoundary as string)
        || (missing && (typeof v.reason !== 'string' || !v.reason))) reject()
      previous = v.endSeconds as number
    }
  }
  checkIntervals(windows, false); checkIntervals(gaps, true)
  for (const item of windows) {
    const v = object(item)
    if (gaps.some(item => { const gap = object(item); return (v.startSeconds as number) < (gap.endSeconds as number) && (v.endSeconds as number) > (gap.startSeconds as number) })) reject()
  }
  let previous = 0
  for (const item of crossings) {
    const v = object(item)
    if (!['rise', 'set', 'darkness-begins', 'darkness-ends'].includes(v.kind as string) || !utc(v.utc) || !utc(v.lowerUtc) || !utc(v.upperUtc) || !finite(v.seconds) || v.seconds < previous || v.seconds > duration || !finite(v.bracketSeconds) || v.bracketSeconds < 0 || v.bracketSeconds > 0.25) reject()
    previous = v.seconds as number
  }
  for (const item of sources) {
    const s = object(item)
    if (typeof s.bodyId !== 'string' || typeof s.source !== 'string' || !s.source || !hash(s.kernelSha256) || !finite(s.startJdTdb) || !finite(s.endJdTdb) || s.startJdTdb > s.endJdTdb) reject()
  }
  return raw as GroundVisibility
}

export async function loadGroundVisibility(base: string | null, profile: 'full' | 'preview', request: GroundVisibilityRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GroundVisibility> {
  return loadGroundPayload(base, profile, '/v1/observation/windows', request, signal, raw => validateGroundVisibility(raw, request), fetcher)
}
