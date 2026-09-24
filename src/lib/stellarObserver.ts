import { tdbToTcb } from '../engine/ephemeris/barycentricTime.ts'
import { validateGroundObservation, type GroundAtmosphere, type GroundObservation, type GroundStation } from './groundObservation.ts'
import { validateStellarMotion, type StellarMotionExperiment, type StellarMotionRequest } from './stellarMotion.ts'
import { readBounded, STATE_TILE_API_VERSION } from './stateTiles.ts'

export type StellarObserverRequest = Omit<StellarMotionRequest, 'targetEpochJulianYearTCB' | 'covariancePolicy'> & { utc: string; station: GroundStation; atmosphere?: GroundAtmosphere }
export type StellarObserverReport = {
  apiVersion: string; catalogVersion: string; catalogManifestSha256: string; earthOrientation: GroundObservation['earthOrientation']
  experiment: {
    schemaVersion: 1; model: string; stellar: StellarMotionExperiment; observation: GroundObservation['result']
    coordinateDirectionBcrs: [number, number, number]; raDeg: number; decDeg: number
    epochJdTdbParts: [number, number]; propagationResidualTdbJulianYears: number; limitations: string[]
    observed: {
      model: string; properDirectionGcrs: [number, number, number]; cirsRaDeg: number; cirsDecDeg: number
      apparentAirless: { azimuthDeg: number; altitudeDeg: number }; solarElongationDeg: number
      solarDeflectionLimited: boolean; warnings: string[]; limitations: string[]
      refracted?: { azimuthDeg: number; altitudeDeg: number }
      refractionStatus: 'not-requested' | 'outside-altitude-domain' | 'applied'
    }
  }
}
const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid stellar observer object')
  return raw as Record<string, unknown>
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export async function validateStellarObserver(raw: unknown, request: StellarObserverRequest, signal?: AbortSignal): Promise<StellarObserverReport> {
  signal?.throwIfAborted()
  validateStellarObserverRequest(request)
  const envelope = object(raw), e = object(envelope.experiment)
  const reject = (): never => { throw new Error('Stellar observer identity or coordinate contract mismatch') }
  if (e.schemaVersion !== 1 || e.model !== 'source-gaia-starpm-pmpx-earth-station-v1') reject()
  const ground = validateGroundObservation({ ...envelope, result: e.observation }, { utc: request.utc, station: request.station, bodyIds: ['naif:10'], ...(request.atmosphere ? { atmosphere: request.atmosphere } : {}) })
  const observer = ground.result.observerState
  if (!observer) return reject()
  for (const bodyId of ['naif:399', 'naif:10']) {
    if (!ground.result.sources.some(source => source.bodyId === bodyId && source.startJdTdb <= ground.result.jdTdb && source.endJdTdb >= ground.result.jdTdb)) reject()
  }
  if (ground.result.contract.observerStateModel !== 'SOFA-Apco; terrestrial rotation plus source Earth barycentric state') reject()
  const epoch = e.epochJdTdbParts
  if (!Array.isArray(epoch) || epoch.length !== 2 || !epoch.every(value => finite(value) && Math.abs(value) <= 10_000_000) ||
      epoch.some((value, i) => value !== observer.epochJdTdbParts[i])) reject()
  const parts = epoch as [number, number]
  const days = Math.floor(parts[0])+Math.floor(parts[1]), fractions = (parts[0]-Math.floor(parts[0]))+(parts[1]-Math.floor(parts[1]))
  const carry = Math.floor(fractions)
  const tcb = tdbToTcb({ day: days+carry, fraction: fractions-carry })
  const expectedYear = 2000+((tcb.day-2451545)+tcb.fraction)/365.25
  const nested = object(e.stellar), state = object(nested.result), year = state.targetEpochJulianYearTCB
  if (!finite(year) || Math.abs(year-expectedYear)*365.25*86400 > 2e-6) return reject()
  const stellar = await validateStellarMotion({ apiVersion: envelope.apiVersion, experiment: nested }, {
    originalManifestBase64: request.originalManifestBase64, originalRowsCsvBase64: request.originalRowsCsvBase64,
    sourceId: request.sourceId, radialVelocityPolicy: request.radialVelocityPolicy, targetEpochJulianYearTCB: year,
  }, signal)
  const residual = ((parts[0]-stellar.result.targetJdTdbParts[0])+(parts[1]-stellar.result.targetJdTdbParts[1]))/365.25
  const direction = e.coordinateDirectionBcrs
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(finite) || Math.abs(Math.hypot(...direction)-1) > 1e-12 ||
      !finite(e.raDeg) || e.raDeg < 0 || e.raDeg >= 360 || !finite(e.decDeg) || Math.abs(e.decDeg) > 90 ||
      !finite(e.propagationResidualTdbJulianYears) || Math.abs(e.propagationResidualTdbJulianYears-residual)*365.25*86400 > 2e-6 ||
      !Array.isArray(e.limitations) || !e.limitations.length || !e.limitations.every(value => typeof value === 'string' && value.length)) reject()
  const ra = (e.raDeg as number)*Math.PI/180, dec = (e.decDeg as number)*Math.PI/180
  const expected = [Math.cos(ra)*Math.cos(dec), Math.sin(ra)*Math.cos(dec), Math.sin(dec)]
  if (expected.some((value, i) => Math.abs(value-(direction as number[])[i]) > 1e-12)) reject()
  const observed = object(e.observed), airless = object(observed.apparentAirless), proper = observed.properDirectionGcrs
  if (observed.model !== 'sofa-ldsun-ab-cirs-atioq-v1' || !Array.isArray(proper) || proper.length !== 3 || !proper.every(finite) || Math.abs(Math.hypot(...proper)-1) > 1e-12 ||
      !finite(observed.cirsRaDeg) || observed.cirsRaDeg < 0 || observed.cirsRaDeg >= 360 || !finite(observed.cirsDecDeg) || Math.abs(observed.cirsDecDeg) > 90 ||
      !finite(airless.azimuthDeg) || airless.azimuthDeg < 0 || airless.azimuthDeg >= 360 || !finite(airless.altitudeDeg) || Math.abs(airless.altitudeDeg) > 90 ||
      !finite(observed.solarElongationDeg) || observed.solarElongationDeg < 0 || observed.solarElongationDeg > 180 || typeof observed.solarDeflectionLimited !== 'boolean' ||
      !Array.isArray(observed.warnings) || !observed.warnings.every(value => typeof value === 'string') ||
      !Array.isArray(observed.limitations) || !observed.limitations.length || !observed.limitations.every(value => typeof value === 'string' && value.length)) reject()
  if ((observed.warnings as string[]).includes('solar-deflection-limited-near-solar-center') !== observed.solarDeflectionLimited) reject()
  const refractionStatus = !request.atmosphere ? 'not-requested' : (airless.altitudeDeg as number) < 5 ? 'outside-altitude-domain' : 'applied'
  if (observed.refractionStatus !== refractionStatus ||
      (observed.warnings as string[]).includes('refraction-outside-supported-altitude-at-least-5-deg') !== (refractionStatus === 'outside-altitude-domain')) reject()
  if (refractionStatus === 'applied') {
    const refracted = object(observed.refracted)
    if (!finite(refracted.azimuthDeg) || refracted.azimuthDeg < 0 || refracted.azimuthDeg >= 360 || !finite(refracted.altitudeDeg) || Math.abs(refracted.altitudeDeg) > 90) reject()
  } else if (observed.refracted != null) reject()
  signal?.throwIfAborted()
  return raw as StellarObserverReport
}

export function validateStellarObserverRequest(request: StellarObserverRequest): void {
  if (!request || typeof request !== 'object' || !request.station || typeof request.station !== 'object' ||
      typeof request.utc !== 'string' || typeof request.sourceId !== 'string' ||
      typeof request.originalManifestBase64 !== 'string' || typeof request.originalRowsCsvBase64 !== 'string') throw new Error('Explicit stellar observer request fields required')
  const s = request.station
  const a = request.atmosphere
  if (a && (![a.pressureHPa, a.temperatureC, a.relativeHumidity, a.wavelengthMicrometers].every(finite) || a.pressureHPa < 0 || a.pressureHPa > 1100 ||
      a.temperatureC < -100 || a.temperatureC > 100 || a.relativeHumidity < 0 || a.relativeHumidity > 1 || a.wavelengthMicrometers < 0.1 || a.wavelengthMicrometers > 1e6)) throw new Error('Invalid stellar observer atmosphere')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(request.utc) ||
      ![s.longitudeDeg, s.latitudeDeg, s.heightMeters].every(finite) || Math.abs(s.longitudeDeg) > 180 || Math.abs(s.latitudeDeg) > 90 || s.heightMeters < -1000 || s.heightMeters > 100000 ||
      !/^[1-9][0-9]{0,18}$/.test(request.sourceId) || BigInt(request.sourceId) > 9223372036854775807n || request.radialVelocityPolicy !== 'spectroscopic-as-astrometric' ||
      !request.originalManifestBase64.length || request.originalManifestBase64.length > 4*Math.ceil((1<<20)/3) ||
      !request.originalRowsCsvBase64.length || request.originalRowsCsvBase64.length > 4*Math.ceil((16<<20)/3)) throw new Error('Invalid stellar observer request or source budget')
}

export async function loadStellarObserver(base: string, request: StellarObserverRequest, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return (await loadStellarObserverReceipt(base, request, signal, fetcher)).report
}

export async function loadStellarObserverReceipt(base: string, request: StellarObserverRequest, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const deadline = performance.now() + 25_000
  validateStellarObserverRequest(request)
  // Validation after network awaits must use the same inputs as the wire.
  request = { ...request, station: { ...request.station }, ...(request.atmosphere ? { atmosphere: { ...request.atmosphere } } : {}) }
  if (!base.trim()) throw new Error('Stellar observer backend required')
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const check = () => {
    if (performance.now() >= deadline) controller.abort(new Error('Stellar observer deadline exceeded'))
    controller.signal.throwIfAborted()
  }
  const timer = setTimeout(() => controller.abort(new Error('Stellar observer deadline exceeded')), Math.max(0, deadline-performance.now()))
  let response: Response | undefined
  try {
    check()
    const body = JSON.stringify(request)
    check()
    response = await fetcher(`${base.trim().replace(/\/+$/, '')}/v1/stellar/observer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal, cache: 'no-store' })
    check()
    const originalResponseJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readBounded(response, 'application/json', 14<<20, controller.signal))
    const raw: unknown = JSON.parse(originalResponseJson)
    check()
    if (!response.ok) {
      const error = object(object(raw).error)
      throw new Error(typeof error.message === 'string' ? error.message : `Stellar observer HTTP ${response.status}`)
    }
    if (object(raw).apiVersion !== STATE_TILE_API_VERSION) throw new Error('Unsupported stellar observer API')
    const report = await validateStellarObserver(raw, request, controller.signal)
    check()
    return { report, originalResponseJson }
  } catch (error) {
    if (!response?.body?.locked) await response?.body?.cancel().catch(() => undefined)
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
