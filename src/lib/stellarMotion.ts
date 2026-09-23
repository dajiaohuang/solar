import { readBounded, STATE_TILE_API_VERSION } from './stateTiles'
import { selectedGaiaCsvSource } from './gaiaCsvSource'
import { validateStellarCovariance, type StellarCovariance } from './stellarCovariance'

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
const digest = async (encoded: string) => {
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('')
}
export function stellarSourceBase64(bytes: Uint8Array, limit: number): string {
  if (!bytes.length || bytes.length > limit) throw new Error('Stellar source byte budget exceeded')
  let binary = ''
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
  return btoa(binary)
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
  for (const date of [r.sourceJdTdbParts, r.targetJdTdbParts]) if (!Array.isArray(date) || date.length !== 2 || !date.every(finite)) reject()
  for (const field of ['raDeg','decDeg','parallaxMas','pmraMasPerJulianYear','pmdecMasPerJulianYear','radialVelocityKmPerSecond']) if (!finite(s[field])) reject()
  if ((s.raDeg as number) < 0 || (s.raDeg as number) >= 360 || Math.abs(s.decDeg as number) >= 90 || (s.parallaxMas as number) <= 0) reject()
  const [manifestHash, rowsHash] = await Promise.all([digest(request.originalManifestBase64), digest(request.originalRowsCsvBase64)])
  if (e.manifestSha256 !== manifestHash || e.rowsSha256 !== rowsHash) reject()
  signal?.throwIfAborted()
  const original = await selectedGaiaCsvSource(Uint8Array.from(atob(request.originalRowsCsvBase64), char => char.charCodeAt(0)), request.sourceId, signal)
  if (Object.keys(original).length !== Object.keys(source).length || Object.entries(original).some(([key, value]) => source[key] !== value)) reject()
  if (request.covariancePolicy) validateStellarCovariance(e.formalCovariance, original, request.targetEpochJulianYearTCB)
  else if (e.formalCovariance !== undefined) reject()
  return e as StellarMotionExperiment
}
export async function loadStellarMotion(base: string, request: StellarMotionRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<StellarMotionExperiment> {
  if (!base.trim()) throw new Error('A configured backend is required for stellar motion')
  if (!/^[1-9][0-9]{0,18}$/.test(request.sourceId) || BigInt(request.sourceId) > 9223372036854775807n
    || !finite(request.targetEpochJulianYearTCB) || Math.abs(request.targetEpochJulianYearTCB - 2016) > 100
    || request.radialVelocityPolicy !== 'spectroscopic-as-astrometric'
    || (request.covariancePolicy !== undefined && request.covariancePolicy !== 'independent-spectroscopic-rv')
    || !request.originalManifestBase64.length || request.originalManifestBase64.length > 4 * Math.ceil((1 << 20) / 3)
    || !request.originalRowsCsvBase64.length || request.originalRowsCsvBase64.length > 4 * Math.ceil((8 << 20) / 3)) throw new Error('Invalid stellar request or source budget')
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new Error('Stellar request deadline exceeded')), 25_000)
  let response: Response | undefined
  try {
    controller.signal.throwIfAborted()
    response = await fetcher(`${base.trim().replace(/\/+$/, '')}/v1/stellar/motion`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(request), signal: controller.signal, cache: 'no-store' })
    const raw: unknown = JSON.parse(new TextDecoder().decode(await readBounded(response, 'application/json', 14 << 20)))
    controller.signal.throwIfAborted()
    if (!response.ok) {
      const error = object(object(raw).error)
      throw new Error(typeof error.message === 'string' ? error.message : `Stellar HTTP ${response.status}`)
    }
    const result = await validateStellarMotion(raw, request, controller.signal)
    controller.signal.throwIfAborted()
    return result
  } catch (error) {
    if (!response?.body?.locked) await response?.body?.cancel().catch(() => undefined)
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
