import { OCCULTATION_MAX_EVALUATIONS, occultationScanIntervalCount } from '../engine/events/occultationContacts.ts'

type Vector = [number, number, number]
export type EllipsoidRayContactInput = {
  schemaVersion: 1
  targetId: number
  observerId: number
  directionJ2000: Vector
  referenceEpochTdb: number
  startSeconds: number
  endSeconds: number
  maxStepSeconds: number
  toleranceSeconds: number
  aberration: 'NONE' | 'CN'
  maxLightTimeSeconds?: number
}

/** Parse the user-controlled event envelope before source retrieval. This is
 * an input contract, not ephemeris, shape or physical-accuracy validation. */
export function parseEllipsoidRayContactInput(bytes: ArrayBuffer): EllipsoidRayContactInput {
  if (!bytes.byteLength || bytes.byteLength > 65536) throw new RangeError('Ellipsoid-ray input must fit 64 KiB')
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const { targetId, observerId, directionJ2000, referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds } = input ?? {}
  const margin = input?.maxLightTimeSeconds ?? 36000
  const directionLength = Array.isArray(directionJ2000) && directionJ2000.length === 3 ? Math.hypot(...directionJ2000) : NaN
  const invalidLightTime = input?.aberration === 'CN'
    ? (input.maxLightTimeSeconds !== undefined && (typeof input.maxLightTimeSeconds !== 'number' || !Number.isFinite(input.maxLightTimeSeconds))) ||
      !Number.isFinite(margin) || margin <= 0 || margin > 86400
    : input?.maxLightTimeSeconds !== undefined
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['schemaVersion', 'targetId', 'observerId', 'directionJ2000', 'referenceEpochTdb', 'startSeconds', 'endSeconds',
        'maxStepSeconds', 'toleranceSeconds', 'aberration', 'maxLightTimeSeconds'].includes(key)) ||
      input.schemaVersion !== 1 || !Number.isSafeInteger(targetId) || targetId <= 0 || !Number.isSafeInteger(observerId) || observerId < 0 || targetId === observerId ||
      !Array.isArray(directionJ2000) || directionJ2000.length !== 3 || !directionJ2000.every(Number.isFinite) || !(directionLength > 0) || !Number.isFinite(directionLength) ||
      ![referenceEpochTdb, startSeconds, endSeconds, maxStepSeconds, toleranceSeconds].every(Number.isFinite) || endSeconds < startSeconds ||
      endSeconds-startSeconds > 365*86400 || maxStepSeconds <= 0 || toleranceSeconds <= 0 || toleranceSeconds > maxStepSeconds ||
      !['NONE', 'CN'].includes(input.aberration) || invalidLightTime) {
    throw new RangeError('Expected distinct exact NAIF target/observer IDs, finite J2000 point-source direction, bounded TDB search and NONE or CN')
  }
  const intervals = occultationScanIntervalCount(endSeconds-startSeconds, maxStepSeconds, startSeconds, endSeconds, OCCULTATION_MAX_EVALUATIONS)
  if (!Number.isSafeInteger(intervals) || intervals+1 > OCCULTATION_MAX_EVALUATIONS) throw new RangeError(`Ellipsoid-ray scan exceeds the ${OCCULTATION_MAX_EVALUATIONS} geometry-evaluation budget`)
  return { ...input, directionJ2000: [...directionJ2000] as Vector }
}
