import { readBounded, STATE_TILE_API_VERSION } from './stateTiles.ts'
import { selectedGaiaCsvSource } from './gaiaCsvSource.ts'
import { validateStellarCovariance, type StellarCovariance } from './stellarCovariance.ts'
import { tcbToTdb } from '../engine/ephemeris/barycentricTime.ts'

export type StellarMotionRequest = {
  originalManifestBase64: string; originalRowsCsvBase64: string; sourceId: string
  targetEpochJulianYearTCB: number; radialVelocityPolicy: 'spectroscopic-as-astrometric'
  covariancePolicy?: 'independent-spectroscopic-rv'
}
export type StellarMotionExperiment = {
  formalCovariance?: StellarCovariance
  schemaVersion: 1; manifestSha256: string; rowsSha256: string
  originalManifestBase64: string; originalRowsCsvBase64: string
  selectedSource: Record<string, unknown>; provenanceBoundary: string
  result: {
    model: string; sourceId: string; targetEpochJulianYearTCB: number
    sourceJdTdbParts: [number, number]; targetJdTdbParts: [number, number]
    tdbCompatibleScaleFactor: number; radialVelocityPolicy: string; limitations: string[]
    stateTCBCompatible: { raDeg: number; decDeg: number; parallaxMas: number; pmraMasPerJulianYear: number; pmdecMasPerJulianYear: number; radialVelocityKmPerSecond: number }
  }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stellar response')
  return value as Record<string, unknown>
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function validateEpochParts(raw: unknown, yearTCB: number) {
  const reject = (): never => { throw new Error('Stellar TDB epoch does not match the requested TCB epoch') }
  if (!Array.isArray(raw) || raw.length !== 2 || !raw.every(value => finite(value) && Math.abs(value) <= 10_000_000) ||
      !finite(yearTCB) || Math.abs(yearTCB-2016) > 100) reject()
  const parts = raw as [number, number]
  const elapsed = (yearTCB-2000)*365.25, whole = Math.floor(elapsed)
  const expected = tcbToTdb({ day: 2451545+whole, fraction: elapsed-whole })
  // Compare two-part dates without first rounding either to a scalar JD.
  // Two microseconds allow binary64 split/operation rounding, not epoch drift
  // or omission of the TCB/TDB scale/offset. This is a receipt tolerance only.
  const differenceDays = (parts[0]-expected.day)+(parts[1]-expected.fraction)
  if (!finite(differenceDays) || Math.abs(differenceDays)*86400 > 2e-6) reject()
}
const digest = async (bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) => {
  signal?.throwIfAborted()
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  signal?.throwIfAborted()
  return Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('')
}
export function stellarSourceBase64(bytes: Uint8Array, limit: number): string {
  if (!bytes.length || bytes.length > limit) throw new Error('Stellar source byte budget exceeded')
  const chunks: string[] = []
  // Multiples of three preserve canonical padding when encoded chunks join.
  for (let at = 0; at < bytes.length; at += 12288) chunks.push(btoa(String.fromCharCode(...bytes.subarray(at, at + 12288))))
  return chunks.join('')
}
export async function validateStellarMotion(raw: unknown, request: StellarMotionRequest, signal?: AbortSignal): Promise<StellarMotionExperiment> {
  signal?.throwIfAborted()
  const envelope = object(raw), e = object(envelope.experiment), r = object(e.result), s = object(r.stateTCBCompatible), source = object(e.selectedSource)
  const reject = () => { throw new Error('Stellar source identity or model contract mismatch') }
  if (envelope.apiVersion !== STATE_TILE_API_VERSION || e.schemaVersion !== 1
    || e.originalManifestBase64 !== request.originalManifestBase64 || e.originalRowsCsvBase64 !== request.originalRowsCsvBase64
    || source.source_id !== request.sourceId || source.ref_epoch !== 2016
    || r.sourceId !== request.sourceId || r.targetEpochJulianYearTCB !== request.targetEpochJulianYearTCB
    || r.model !== 'gofa-starpm-scaled-gaia-single-star-v1' || r.radialVelocityPolicy !== request.radialVelocityPolicy
    || r.tdbCompatibleScaleFactor !== 1 - 1.550519768e-8
    || typeof e.provenanceBoundary !== 'string' || !e.provenanceBoundary
    || !Array.isArray(r.limitations) || !r.limitations.length || !r.limitations.every(v => typeof v === 'string' && v.length)) reject()
  validateEpochParts(r.sourceJdTdbParts, 2016)
  validateEpochParts(r.targetJdTdbParts, request.targetEpochJulianYearTCB)
  for (const field of ['raDeg','decDeg','parallaxMas','pmraMasPerJulianYear','pmdecMasPerJulianYear','radialVelocityKmPerSecond']) if (!finite(s[field])) reject()
  if ((s.raDeg as number) < 0 || (s.raDeg as number) >= 360 || Math.abs(s.decDeg as number) >= 90 || (s.parallaxMas as number) <= 0) reject()
  const manifestBytes = Uint8Array.from(atob(request.originalManifestBase64), char => char.charCodeAt(0))
  signal?.throwIfAborted()
  const rowsBytes = Uint8Array.from(atob(request.originalRowsCsvBase64), char => char.charCodeAt(0))
  signal?.throwIfAborted()
  const [manifestHash, rowsHash] = await Promise.all([digest(manifestBytes, signal), digest(rowsBytes, signal)])
  if (e.manifestSha256 !== manifestHash || e.rowsSha256 !== rowsHash) reject()
  signal?.throwIfAborted()
  const original = await selectedGaiaCsvSource(rowsBytes, request.sourceId, signal)
  if (Object.keys(original).length !== Object.keys(source).length || Object.entries(original).some(([key, value]) => source[key] !== value)) reject()
  if (request.covariancePolicy) validateStellarCovariance(e.formalCovariance, original, request.targetEpochJulianYearTCB)
  else if (e.formalCovariance !== undefined) reject()
  return e as StellarMotionExperiment
}
export async function loadStellarMotion(base: string, request: StellarMotionRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<StellarMotionExperiment> {
  const deadline = performance.now() + 25_000
  request = { ...request }
  if (!base.trim()) throw new Error('A configured backend is required for stellar motion')
  if (!/^[1-9][0-9]{0,18}$/.test(request.sourceId) || BigInt(request.sourceId) > 9223372036854775807n
    || !finite(request.targetEpochJulianYearTCB) || Math.abs(request.targetEpochJulianYearTCB - 2016) > 100
    || request.radialVelocityPolicy !== 'spectroscopic-as-astrometric'
    || (request.covariancePolicy !== undefined && request.covariancePolicy !== 'independent-spectroscopic-rv')
    || !request.originalManifestBase64.length || request.originalManifestBase64.length > 4 * Math.ceil((1 << 20) / 3)
    || !request.originalRowsCsvBase64.length || request.originalRowsCsvBase64.length > 4 * Math.ceil((16 << 20) / 3)) throw new Error('Invalid stellar request or source budget')
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const check = () => {
    if (performance.now() >= deadline) controller.abort(new Error('Stellar request deadline exceeded'))
    controller.signal.throwIfAborted()
  }
  const timer = setTimeout(() => controller.abort(new Error('Stellar request deadline exceeded')), Math.max(0, deadline-performance.now()))
  let response: Response | undefined
  try {
    check()
    const body = JSON.stringify(request)
    check()
    response = await fetcher(`${base.trim().replace(/\/+$/, '')}/v1/stellar/motion`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body, signal: controller.signal, cache: 'no-store' })
    check()
    const bytes = await readBounded(response, 'application/json', 14 << 20, controller.signal)
    check()
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    check()
    const raw: unknown = JSON.parse(text)
    check()
    if (!response.ok) {
      const error = object(object(raw).error)
      throw new Error(typeof error.message === 'string' ? error.message : `Stellar HTTP ${response.status}`)
    }
    const result = await validateStellarMotion(raw, request, controller.signal)
    check()
    return result
  } catch (error) {
    if (!response?.body?.locked) await response?.body?.cancel().catch(() => undefined)
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
