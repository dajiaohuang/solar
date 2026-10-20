import capacity from '../data/gaiaCapacity.json'
import { readBounded, STATE_TILE_API_VERSION } from './stateTiles.ts'
import { selectedGaiaCsvSource } from './gaiaCsvSource.ts'
import { validateStellarCovariance, type StellarCovariance } from './stellarCovariance.ts'
import { tcbToTdb } from '../engine/ephemeris/barycentricTime.ts'
import { ADVERTISED_QUEUE_RETRY, fetchRetryableResponse } from './retryableHttpResponse'
import type { GaiaChunkDescriptor } from './gaiaChunks'

export type StellarMotionRequest = {
  originalManifestBase64: string; originalRowsCsvBase64: string; sourceId: string
  targetEpochJulianYearTCB: number; radialVelocityPolicy: 'spectroscopic-as-astrometric'
  covariancePolicy?: 'independent-spectroscopic-rv'
}
export const GAIA_ZERO_RADIAL_MOTION_POLICY = 'gaia-mu-r-zero-when-rv-missing' as const
export type StellarMotionRadialVelocityPolicy = StellarMotionRequest['radialVelocityPolicy'] | typeof GAIA_ZERO_RADIAL_MOTION_POLICY
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
export type StellarMotionBatchRow = {
  sourceId: string; status: 'propagated' | 'missing' | 'rejected'; reason?: string
  zeroRadialMotionAssumed?: boolean
  state?: { raDeg: number; decDeg: number; parallaxMas: number; pmraMasPerJulianYear: number; pmdecMasPerJulianYear: number; radialVelocityKmPerSecond: number }
}
export type StellarMotionBatch = {
  schemaVersion: 1; model: string; targetEpochJulianYearTCB: number
  sourceJdTdbParts: [number, number]; targetJdTdbParts: [number, number]
  tdbCompatibleScaleFactor: number; radialVelocityPolicy: string
  inputRows: number; propagatedRows: number; missingRows: number; rejectedRows: number
  zeroRadialMotionRows?: number
  rows: StellarMotionBatchRow[]; limitations: string[]
}
export type StellarMotionTileReceipt = {
  manifestSha256: string; chunkPath: string; chunkSha256: string; provenanceBoundary: string; motion: StellarMotionBatch
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stellar response')
  return value as Record<string, unknown>
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value)
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
export type PreparedStellarMotionManifest = Readonly<{ manifestSha256: string; originalManifestBase64: string }>
const preparedManifestByteLengths = new WeakMap<object, number>()
/** Hash and encode one immutable upload snapshot so every tile can reuse it. */
export async function prepareStellarMotionManifest(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<PreparedStellarMotionManifest> {
  if (bytes.byteLength < 1 || bytes.byteLength > capacity.maxManifestBytes) throw new Error('Gaia manifest size exceeds budget')
  const snapshot = new Uint8Array(bytes), manifestSha256 = await digest(snapshot, signal)
  const prepared = Object.freeze({ manifestSha256, originalManifestBase64: stellarSourceBase64(snapshot, capacity.maxManifestBytes) })
  preparedManifestByteLengths.set(prepared, snapshot.byteLength)
  return prepared
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
    || !request.originalManifestBase64.length || request.originalManifestBase64.length > 4 * Math.ceil(capacity.maxManifestBytes / 3)
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
    response = await fetchRetryableResponse(fetcher, `${base.trim().replace(/\/+$/, '')}/v1/stellar/motion`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body, signal: controller.signal, cache: 'no-store' }, controller.signal, ADVERTISED_QUEUE_RETRY)
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

/** Upload one browser-verified Gaia chunk without changing its source bytes. */
export async function loadStellarMotionTile(base: string, request: {
  manifestBytes: Uint8Array<ArrayBuffer>; manifestSha256: string; descriptor: GaiaChunkDescriptor
  chunkBytes: Uint8Array<ArrayBuffer>; sourceIds: ArrayLike<bigint>; targetEpochJulianYearTCB: number
  radialVelocityAvailability: Uint8Array<ArrayBuffer>
  radialVelocityPolicy: StellarMotionRadialVelocityPolicy
  preparedManifest?: PreparedStellarMotionManifest
}, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<StellarMotionTileReceipt> {
  const deadline = performance.now() + 40_000
  const check = () => {
    if (performance.now() >= deadline) throw new Error('Stellar batch request deadline exceeded')
    signal.throwIfAborted()
  }
  check()
  const configuredBase = new URL(base)
  if (!base.trim() || request.manifestBytes.byteLength < 1 || request.manifestBytes.byteLength > capacity.maxManifestBytes
    || request.chunkBytes.byteLength !== request.descriptor.bytes || request.chunkBytes.byteLength > capacity.maxChunkBytes
    || request.sourceIds.length < 1 || request.sourceIds.length > capacity.maxChunkRows || request.sourceIds.length !== request.descriptor.rows || !/^[a-f0-9]{64}$/.test(request.manifestSha256)
    || request.radialVelocityAvailability.length !== request.sourceIds.length
    || !/^[a-f0-9]{64}$/.test(request.descriptor.sha256) || !/^r\d+-d\d+\.json$/.test(request.descriptor.path)
    || !['http:', 'https:'].includes(configuredBase.protocol) || configuredBase.username || configuredBase.password || configuredBase.search || configuredBase.hash
    || !finite(request.targetEpochJulianYearTCB) || Math.abs(request.targetEpochJulianYearTCB - 2016) > 100
    || (request.radialVelocityPolicy !== 'spectroscopic-as-astrometric' && request.radialVelocityPolicy !== GAIA_ZERO_RADIAL_MOTION_POLICY)) throw new Error('Invalid Gaia motion batch request or source budget')
  if (request.preparedManifest && (preparedManifestByteLengths.get(request.preparedManifest) !== request.manifestBytes.byteLength
    || request.preparedManifest.manifestSha256 !== request.manifestSha256)) throw new Error('Prepared Gaia manifest does not match the verified source identity')
  let previous = 0n
  for (let index = 0; index < request.sourceIds.length; index++) {
    const id = request.sourceIds[index]
    if (typeof id !== 'bigint' || id <= previous || id > 9223372036854775807n
      || (request.radialVelocityAvailability[index] !== 0 && request.radialVelocityAvailability[index] !== 1)) throw new Error('Gaia motion source IDs or radial-velocity availability differ from the verified row budget')
    previous = id
  }
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new Error('Stellar batch request deadline exceeded')), Math.max(0, deadline - performance.now()))
  let response: Response | undefined
  try {
    check()
    const [manifestSha256, chunkSha256] = await Promise.all([request.preparedManifest
      ? Promise.resolve(request.preparedManifest.manifestSha256) : digest(request.manifestBytes, controller.signal), digest(request.chunkBytes, controller.signal)])
    if (manifestSha256 !== request.manifestSha256 || chunkSha256 !== request.descriptor.sha256) throw new Error('Gaia motion source hash differs from its browser-verified descriptor')
    const wire = {
      originalManifestBase64: request.preparedManifest?.originalManifestBase64 ?? stellarSourceBase64(request.manifestBytes, capacity.maxManifestBytes),
      chunkPath: request.descriptor.path,
      originalChunkBase64: stellarSourceBase64(request.chunkBytes, capacity.maxChunkBytes),
      targetEpochJulianYearTCB: request.targetEpochJulianYearTCB,
      radialVelocityPolicy: request.radialVelocityPolicy,
    }
    check()
    response = await fetchRetryableResponse(fetcher, `${base.trim().replace(/\/+$/, '')}/v1/stellar/motion/tile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wire), signal: controller.signal, cache: 'no-store',
    }, controller.signal, ADVERTISED_QUEUE_RETRY)
    check()
    const bytes = await readBounded(response, 'application/json', 14 << 20, controller.signal)
    check()
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    check()
    if (!response.ok) {
      const error = object(object(raw).error)
      throw new Error(typeof error.message === 'string' ? error.message : `Stellar batch HTTP ${response.status}`)
    }
    const envelope = object(raw), experiment = object(envelope.experiment), motion = object(experiment.motion)
    const reject: () => never = () => { throw new Error('Gaia motion batch response does not match its source or model contract') }
    if (envelope.apiVersion !== STATE_TILE_API_VERSION || experiment.manifestSha256 !== request.manifestSha256
      || experiment.chunkPath !== request.descriptor.path || experiment.chunkSha256 !== request.descriptor.sha256
      || typeof experiment.provenanceBoundary !== 'string' || !experiment.provenanceBoundary
      || motion.schemaVersion !== 1 || motion.model !== 'gofa-starpm-scaled-gaia-single-star-v1'
      || motion.targetEpochJulianYearTCB !== request.targetEpochJulianYearTCB
      || motion.radialVelocityPolicy !== request.radialVelocityPolicy || motion.tdbCompatibleScaleFactor !== 1 - 1.550519768e-8
      || motion.inputRows !== request.sourceIds.length || !Array.isArray(motion.rows) || motion.rows.length !== request.sourceIds.length
      || !safeInteger(motion.propagatedRows) || !safeInteger(motion.missingRows) || !safeInteger(motion.rejectedRows)
      || (motion.zeroRadialMotionRows !== undefined && (!safeInteger(motion.zeroRadialMotionRows) || motion.zeroRadialMotionRows < 0 || motion.zeroRadialMotionRows > motion.propagatedRows))
      || motion.propagatedRows + motion.missingRows + motion.rejectedRows !== motion.inputRows
      || !Array.isArray(motion.limitations) || motion.limitations.length < 1 || !motion.limitations.every(value => typeof value === 'string' && value.length > 0)) reject()
    validateEpochParts(motion.sourceJdTdbParts, 2016)
    validateEpochParts(motion.targetJdTdbParts, request.targetEpochJulianYearTCB)
    let propagatedRows = 0, missingRows = 0, rejectedRows = 0, zeroRadialMotionRows = 0
    for (let index = 0; index < motion.rows.length; index++) {
      const row = object(motion.rows[index])
      if (row.sourceId !== request.sourceIds[index].toString()) reject()
      if (row.status === 'propagated') {
        const state = object(row.state)
        const expectedZeroRadialMotionAssumption = request.radialVelocityPolicy === GAIA_ZERO_RADIAL_MOTION_POLICY
          && request.radialVelocityAvailability[index] === 0
        if (row.reason !== undefined || !finite(state.raDeg) || state.raDeg < 0 || state.raDeg >= 360
          || !finite(state.decDeg) || Math.abs(state.decDeg) >= 90 || !finite(state.parallaxMas) || state.parallaxMas <= 0
          || !finite(state.pmraMasPerJulianYear) || !finite(state.pmdecMasPerJulianYear) || !finite(state.radialVelocityKmPerSecond)
          || (row.zeroRadialMotionAssumed !== undefined && typeof row.zeroRadialMotionAssumed !== 'boolean')
          || (row.zeroRadialMotionAssumed === true) !== expectedZeroRadialMotionAssumption) reject()
        if (row.zeroRadialMotionAssumed === true) zeroRadialMotionRows++
        propagatedRows++
      } else if (row.status === 'missing' || row.status === 'rejected') {
        if (row.state !== undefined || typeof row.reason !== 'string' || !row.reason || row.zeroRadialMotionAssumed !== undefined) reject()
        if (row.status === 'missing') missingRows++
        else rejectedRows++
      } else reject()
    }
    if (propagatedRows !== motion.propagatedRows || missingRows !== motion.missingRows || rejectedRows !== motion.rejectedRows
      || zeroRadialMotionRows !== (motion.zeroRadialMotionRows ?? 0)) reject()
    check()
    return experiment as unknown as StellarMotionTileReceipt
  } catch (error) {
    if (!response?.body?.locked) await response?.body?.cancel().catch(() => undefined)
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
