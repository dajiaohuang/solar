import { readBounded, STATE_TILE_API_VERSION } from './stateTiles.ts'
import { ADVERTISED_QUEUE_RETRY, fetchRetryableResponse } from './retryableHttpResponse'

export type GroundStation = { longitudeDeg: number; latitudeDeg: number; heightMeters: number }
export const GROUND_FUTURE_LEAP_UNCERTAINTY_START_UTC = '2027-07-01'
export type GroundAtmosphere = { pressureHPa: number; temperatureC: number; relativeHumidity: number; wavelengthMicrometers: number }
export type GroundObservationRequest = { utc: string; station: GroundStation; bodyIds: string[]; atmosphere?: GroundAtmosphere }
export type GroundDirection = { azimuthDeg: number; altitudeDeg: number }
type GroundVector = [number, number, number]
export type GroundEopManifest = { sourceUrl: string; retrievedAt: string; sha256: string }
export type GroundEopSample = {
  mjdUtc: number; bracketMjdUtc: [number, number]; predicted: boolean; celestialPoleCorrectionAvailable: boolean
  sourceSha256: string; retrievedAt: string; xpArcsec: number; ypArcsec: number; ut1MinusUtcSeconds: number
  xpErrorArcsec: number; ypErrorArcsec: number; ut1ErrorSeconds: number
  dXMas?: number; dYMas?: number; dXErrorMas?: number; dYErrorMas?: number
  poleFlag: 'I' | 'P'; ut1Flag: 'I' | 'P'; cpoFlag: '' | 'I' | 'P'
}
export type GroundObservation = {
  apiVersion: string; catalogVersion: string; catalogManifestSha256: string
  earthOrientation: GroundEopManifest; earthOrientationCoverageMjdUtc: [number, number]
  result: {
    model: string; request: GroundObservationRequest; jdTdb: number; jdTt: number; jdUt1: number
    observerState?: { frame: 'J2000'; origin: 'solar-system-barycenter'; positionKm: GroundVector; velocityKmPerSecond: GroundVector; epochJdTdbParts: [number, number] }
    earthOrientation: GroundEopSample
    sources: { bodyId: string; source: string; kernelSha256: string; startJdTdb: number; endJdTdb: number }[]
    bodies: { bodyId: string; status: 'available' | 'missing'; missingReason?: string; geometric?: GroundDirection; apparentAirless?: GroundDirection; refracted?: GroundDirection; lightTimeRangeKm?: number; lightTimeSeconds?: number; emissionJdTdb?: number; emissionJdTdbParts?: [number, number]; geometricPositionKm?: GroundVector; receptionPositionKm?: GroundVector; lightTimeResidualSeconds?: number; warnings: string[] }[]
    warnings: string[]; contract: Record<string, unknown>
  }
}
export class GroundObservationError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid observation response')
  return value as Record<string, unknown>
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')

export function validateGroundObservation(raw: unknown, request: GroundObservationRequest): GroundObservation {
  const value = object(raw), result = object(value.result), echoed = object(result.request), station = object(echoed.station)
  const jdTdb = result.jdTdb
  const eop = object(result.earthOrientation), manifest = object(value.earthOrientation), coverage = value.earthOrientationCoverageMjdUtc, contract = object(result.contract)
  const reject = () => { throw new Error('Observation identity or scientific contract mismatch') }
  const declaredLightTimeTolerance = contract.lightTimeToleranceSeconds
  const lightTimeTolerance = finite(declaredLightTimeTolerance) ? declaredLightTimeTolerance : 0.00005
  if (!finite(jdTdb)) throw new Error('Observation identity or scientific contract mismatch')
  if (value.apiVersion !== STATE_TILE_API_VERSION || typeof value.catalogVersion !== 'string' || !hash(value.catalogManifestSha256)
    || result.model !== 'earth-station-iau2006-2000a-spk-v1' || echoed.utc !== request.utc
    || !texts(echoed.bodyIds) || JSON.stringify(echoed.bodyIds) !== JSON.stringify(request.bodyIds)
    || Object.entries(request.station).some(([key, expected]) => station[key] !== expected)
    || !finite(result.jdTt) || !finite(result.jdUt1)
    || !hash(manifest.sha256) || eop.sourceSha256 !== manifest.sha256 || eop.retrievedAt !== manifest.retrievedAt
    || manifest.sourceUrl !== 'https://data.iers.org/products/eop/rapid/standard/finals2000A.all'
    || typeof manifest.retrievedAt !== 'string' || !Number.isFinite(Date.parse(manifest.retrievedAt))
    || !Array.isArray(coverage) || coverage.length !== 2 || !coverage.every(finite) || coverage[0] >= coverage[1]
    || typeof eop.predicted !== 'boolean' || typeof eop.celestialPoleCorrectionAvailable !== 'boolean'
    || !finite(eop.xpArcsec) || !finite(eop.ypArcsec) || !finite(eop.ut1MinusUtcSeconds)
    || !finite(eop.mjdUtc) || !Array.isArray(eop.bracketMjdUtc) || eop.bracketMjdUtc.length !== 2
    || !eop.bracketMjdUtc.every(finite) || eop.bracketMjdUtc[0] > eop.mjdUtc || eop.bracketMjdUtc[1] < eop.mjdUtc
    || eop.bracketMjdUtc[0] < coverage[0] || eop.bracketMjdUtc[1] > coverage[1]
    || eop.bracketMjdUtc[1] - eop.bracketMjdUtc[0] > 1.01
    || !finite(eop.xpErrorArcsec) || eop.xpErrorArcsec < 0 || !finite(eop.ypErrorArcsec) || eop.ypErrorArcsec < 0
    || !finite(eop.ut1ErrorSeconds) || eop.ut1ErrorSeconds < 0
    || !['I', 'P'].includes(eop.poleFlag as string) || !['I', 'P'].includes(eop.ut1Flag as string)
    || !['', 'I', 'P'].includes(eop.cpoFlag as string)
    || eop.predicted !== (eop.poleFlag === 'P' || eop.ut1Flag === 'P' || eop.cpoFlag === 'P')
    || eop.celestialPoleCorrectionAvailable !== (finite(eop.dXMas) && finite(eop.dYMas) && finite(eop.dXErrorMas) && finite(eop.dYErrorMas)
      && eop.dXErrorMas >= 0 && eop.dYErrorMas >= 0 && (eop.cpoFlag === 'I' || eop.cpoFlag === 'P'))
    || eop.celestialPoleCorrectionAvailable === false && (eop.dXMas != null || eop.dYMas != null || eop.dXErrorMas != null || eop.dYErrorMas != null || eop.cpoFlag !== '')
    || contract.angleUnit !== 'deg' || contract.stationDatum !== 'WGS84-ellipsoidal-height'
    || contract.azimuthConvention !== 'north-zero-east-positive' || contract.physicalUncertainty !== 'not-propagated'
    || contract.epochEvaluation != null && !['seconds-past-j2000-tdb', 'one-part-julian-date-compatibility'].includes(contract.epochEvaluation as string)
    || contract.lightTimeToleranceSeconds != null && (!finite(contract.lightTimeToleranceSeconds) || contract.lightTimeToleranceSeconds <= 0 || contract.lightTimeToleranceSeconds > 0.00005)
    || contract.futureLeapSecondUncertaintyStartUTC !== GROUND_FUTURE_LEAP_UNCERTAINTY_START_UTC
    || !texts(result.warnings) || !Array.isArray(result.bodies) || result.bodies.length !== request.bodyIds.length
    || !Array.isArray(result.sources) || result.sources.length < 2 || result.sources.length > 512) reject()
  if (request.atmosphere) {
    const atmosphere = object(echoed.atmosphere)
    if (Object.entries(request.atmosphere).some(([key, expected]) => atmosphere[key] !== expected)) reject()
  } else if (echoed.atmosphere != null) reject()
  const direction = (raw: unknown) => { const d = object(raw); if (!finite(d.azimuthDeg) || d.azimuthDeg < 0 || d.azimuthDeg >= 360 || !finite(d.altitudeDeg) || Math.abs(d.altitudeDeg) > 90) reject() }
  const vector = (value: unknown): value is GroundVector => Array.isArray(value) && value.length === 3 && value.every(finite)
  const hasVectors = result.observerState != null
  if (hasVectors) {
    const observer = object(result.observerState), epoch = observer.epochJdTdbParts
    if (observer.frame !== 'J2000' || observer.origin !== 'solar-system-barycenter' || !vector(observer.positionKm) || !vector(observer.velocityKmPerSecond)
      || !Array.isArray(epoch) || epoch.length !== 2 || !epoch.every(finite) || epoch[0]+epoch[1] !== jdTdb
      || contract.vectorFrame !== 'J2000' || contract.vectorUnit !== 'km' || contract.vectorOrigin !== 'observer-at-reception') reject()
  }
  for (const [index, raw] of (result.bodies as unknown[]).entries()) {
    const body = object(raw)
    if (body.bodyId !== request.bodyIds[index] || !texts(body.warnings)) reject()
    if (!hasVectors && (body.geometricPositionKm != null || body.receptionPositionKm != null || body.lightTimeResidualSeconds != null)) reject()
    if (body.status === 'available') {
      direction(body.geometric); direction(body.apparentAirless)
      if (body.refracted != null) { if (!request.atmosphere) reject(); direction(body.refracted) }
      if (!finite(body.lightTimeRangeKm) || body.lightTimeRangeKm <= 0 || !finite(body.lightTimeSeconds) || body.lightTimeSeconds <= 0) reject()
      if (body.emissionJdTdb != null && !finite(body.emissionJdTdb)) reject()
      if (body.emissionJdTdbParts != null) {
        const parts = body.emissionJdTdbParts
        if (!finite(body.emissionJdTdb) || !Array.isArray(parts) || parts.length !== 2 || !parts.every(finite) || parts[0] + parts[1] !== body.emissionJdTdb) reject()
      }
      if (hasVectors && (!vector(body.geometricPositionKm) || !vector(body.receptionPositionKm)
        || !finite(body.lightTimeResidualSeconds) || body.lightTimeResidualSeconds < 0 || body.lightTimeResidualSeconds > lightTimeTolerance)) reject()
    } else if (body.status !== 'missing' || typeof body.missingReason !== 'string' || !body.missingReason || body.geometric != null || body.apparentAirless != null || body.refracted != null || body.geometricPositionKm != null || body.receptionPositionKm != null || body.lightTimeResidualSeconds != null) reject()
  }
  for (const raw of result.sources as unknown[]) {
    const source = object(raw)
    if (typeof source.bodyId !== 'string' || typeof source.source !== 'string' || !source.source || !hash(source.kernelSha256)
      || !finite(source.startJdTdb) || !finite(source.endJdTdb) || source.startJdTdb > jdTdb || source.endJdTdb < jdTdb) reject()
  }
  return raw as GroundObservation
}

export async function loadGroundObservation(base: string | null, profile: 'full' | 'preview', request: GroundObservationRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GroundObservation> {
  request = { ...request, station: { ...request.station }, bodyIds: [...request.bodyIds], ...(request.atmosphere ? { atmosphere: { ...request.atmosphere } } : {}) }
  return loadGroundPayload(base, profile, '/v1/observation', request, signal, raw => validateGroundObservation(raw, request), fetcher)
}

export async function loadGroundPayload<T>(base: string | null, profile: 'full' | 'preview', path: string, request: unknown, signal: AbortSignal, validate: (raw: unknown) => T, fetcher: typeof fetch = fetch): Promise<T> {
  const deadline = performance.now() + 25_000
  if (profile !== 'full' || !base?.trim()) throw new GroundObservationError('backend_unavailable', 'Ground observations require a configured full backend')
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const check = () => {
    if (performance.now() >= deadline) controller.abort(new GroundObservationError('deadline', 'Observation deadline exceeded'))
    controller.signal.throwIfAborted()
  }
  const timer = setTimeout(() => controller.abort(new GroundObservationError('deadline', 'Observation deadline exceeded')), Math.max(0, deadline-performance.now()))
  let response: Response | undefined
  try {
    check()
    const body = JSON.stringify(request)
    check()
    response = await fetchRetryableResponse(fetcher, `${base.trim().replace(/\/+$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal, cache: 'no-store' }, controller.signal, ADVERTISED_QUEUE_RETRY)
    check()
    const bytes = await readBounded(response, 'application/json', 1024 * 1024, controller.signal)
    check()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    check()
    const raw: unknown = JSON.parse(text)
    check()
    if (!response.ok) {
      const error = object(object(raw).error)
      throw new GroundObservationError(typeof error.code === 'string' ? error.code : 'failed', typeof error.message === 'string' ? error.message : `Observation HTTP ${response.status}`)
    }
    const result = validate(raw)
    check()
    return result
  } catch (error) {
    if (!response?.body?.locked) await response?.body?.cancel().catch(() => undefined)
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
