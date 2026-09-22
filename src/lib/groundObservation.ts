import { readBounded, STATE_TILE_API_VERSION } from './stateTiles'

export type GroundStation = { longitudeDeg: number; latitudeDeg: number; heightMeters: number }
export type GroundAtmosphere = { pressureHPa: number; temperatureC: number; relativeHumidity: number; wavelengthMicrometers: number }
export type GroundObservationRequest = { utc: string; station: GroundStation; bodyIds: string[]; atmosphere?: GroundAtmosphere }
export type GroundDirection = { azimuthDeg: number; altitudeDeg: number }
export type GroundObservation = {
  apiVersion: string; catalogVersion: string; catalogManifestSha256: string
  earthOrientation: { sourceUrl: string; retrievedAt: string; sha256: string }
  result: {
    model: string; request: GroundObservationRequest; jdTdb: number; jdTt: number; jdUt1: number
    earthOrientation: { predicted: boolean; celestialPoleCorrectionAvailable: boolean; sourceSha256: string; retrievedAt: string; xpArcsec: number; ypArcsec: number; ut1MinusUtcSeconds: number }
    sources: { bodyId: string; source: string; kernelSha256: string; startJdTdb: number; endJdTdb: number }[]
    bodies: { bodyId: string; status: 'available' | 'missing'; missingReason?: string; geometric?: GroundDirection; apparentAirless?: GroundDirection; refracted?: GroundDirection; lightTimeRangeKm?: number; lightTimeSeconds?: number; warnings: string[] }[]
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
  const eop = object(result.earthOrientation), manifest = object(value.earthOrientation), contract = object(result.contract)
  const reject = () => { throw new Error('Observation identity or scientific contract mismatch') }
  if (value.apiVersion !== STATE_TILE_API_VERSION || typeof value.catalogVersion !== 'string' || !hash(value.catalogManifestSha256)
    || result.model !== 'earth-station-iau2006-2000a-spk-v1' || echoed.utc !== request.utc
    || !texts(echoed.bodyIds) || JSON.stringify(echoed.bodyIds) !== JSON.stringify(request.bodyIds)
    || Object.entries(request.station).some(([key, expected]) => station[key] !== expected)
    || !finite(result.jdTdb) || !finite(result.jdTt) || !finite(result.jdUt1)
    || !hash(manifest.sha256) || eop.sourceSha256 !== manifest.sha256 || eop.retrievedAt !== manifest.retrievedAt
    || manifest.sourceUrl !== 'https://data.iers.org/products/eop/rapid/standard/finals2000A.all'
    || typeof manifest.retrievedAt !== 'string' || !Number.isFinite(Date.parse(manifest.retrievedAt))
    || typeof eop.predicted !== 'boolean' || typeof eop.celestialPoleCorrectionAvailable !== 'boolean'
    || !finite(eop.xpArcsec) || !finite(eop.ypArcsec) || !finite(eop.ut1MinusUtcSeconds)
    || contract.angleUnit !== 'deg' || contract.stationDatum !== 'WGS84-ellipsoidal-height'
    || contract.azimuthConvention !== 'north-zero-east-positive' || contract.physicalUncertainty !== 'not-propagated'
    || !texts(result.warnings) || !Array.isArray(result.bodies) || result.bodies.length !== request.bodyIds.length
    || !Array.isArray(result.sources) || result.sources.length < 2 || result.sources.length > 512) reject()
  if (request.atmosphere) {
    const atmosphere = object(echoed.atmosphere)
    if (Object.entries(request.atmosphere).some(([key, expected]) => atmosphere[key] !== expected)) reject()
  } else if (echoed.atmosphere != null) reject()
  const direction = (raw: unknown) => { const d = object(raw); if (!finite(d.azimuthDeg) || d.azimuthDeg < 0 || d.azimuthDeg >= 360 || !finite(d.altitudeDeg) || Math.abs(d.altitudeDeg) > 90) reject() }
  for (const [index, raw] of (result.bodies as unknown[]).entries()) {
    const body = object(raw)
    if (body.bodyId !== request.bodyIds[index] || !texts(body.warnings)) reject()
    if (body.status === 'available') {
      direction(body.geometric); direction(body.apparentAirless)
      if (body.refracted != null) { if (!request.atmosphere) reject(); direction(body.refracted) }
      if (!finite(body.lightTimeRangeKm) || body.lightTimeRangeKm <= 0 || !finite(body.lightTimeSeconds) || body.lightTimeSeconds <= 0) reject()
    } else if (body.status !== 'missing' || typeof body.missingReason !== 'string' || !body.missingReason || body.geometric != null || body.apparentAirless != null || body.refracted != null) reject()
  }
  for (const raw of result.sources as unknown[]) {
    const source = object(raw)
    if (typeof source.bodyId !== 'string' || typeof source.source !== 'string' || !source.source || !hash(source.kernelSha256) || !finite(source.startJdTdb) || !finite(source.endJdTdb) || source.startJdTdb > source.endJdTdb) reject()
  }
  return raw as GroundObservation
}

export async function loadGroundObservation(base: string | null, profile: 'full' | 'preview', request: GroundObservationRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GroundObservation> {
  if (profile !== 'full' || !base?.trim()) throw new GroundObservationError('backend_unavailable', 'Ground observations require a configured full backend')
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new GroundObservationError('deadline', 'Observation deadline exceeded')), 25_000)
  let response: Response | undefined
  try {
    if (controller.signal.aborted) throw controller.signal.reason
    response = await fetcher(`${base.trim().replace(/\/+$/, '')}/v1/observation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal, cache: 'no-store' })
    const raw: unknown = JSON.parse(new TextDecoder().decode(await readBounded(response, 'application/json', 1024 * 1024)))
    if (controller.signal.aborted) throw controller.signal.reason
    if (!response.ok) {
      const error = object(object(raw).error)
      throw new GroundObservationError(typeof error.code === 'string' ? error.code : 'failed', typeof error.message === 'string' ? error.message : `Observation HTTP ${response.status}`)
    }
    return validateGroundObservation(raw, request)
  } catch (error) {
    if (!response?.body?.locked) await response?.body?.cancel().catch(() => undefined)
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
