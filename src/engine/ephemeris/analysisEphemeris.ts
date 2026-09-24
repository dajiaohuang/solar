import { bodyNaifId } from '../../data/ephemerisTargets'
import { createBodyPositionResolver, MissingBodyStateError, scaleVector3, subtractVector3 } from '../../lib/ephemeris'
import type { BodyId, CelestialBody, Vector3 } from '../../types'
import { AU_IN_KM, SECONDS_PER_DAY } from '../units'
import { createKernelResolver, kernelsCoveringInterval, type LoadedKernel } from './kernelPool'
import { EPHEMERIS_MANIFEST, verifiedKernelSha256 } from './kernelStore'
import { utcJulianDayToEt, utcTimeScaleQuality, type TimeScaleQuality } from './timeScales'

export type AnalysisEphemerisPolicy = 'prefer-spk' | 'require-spk'
export type AnalysisBodyModel = 'jpl-spk' | 'approximate-fallback' | 'heliocentric-origin'
export type AnalysisBodyEvidence = { bodyId: BodyId; model: AnalysisBodyModel; source: CelestialBody['source'] }
export type AnalysisEphemerisEvidence = {
  schemaVersion: 1
  policy: AnalysisEphemerisPolicy
  inputTimeScale: 'UTC'
  dynamicalTimeScale: 'TDB' | 'legacy-numeric-jd'
  timeScaleQuality: TimeScaleQuality | null
  frame: 'ECLIPJ2000'
  origin: 'Sun'
  positionUnit: 'AU'
  velocityUnit: 'AU/d'
  startJulianDay: number
  endJulianDay: number
  manifestId: string
  /** Frozen eligible pool, not a claim that each file contributed to every body.
   * Hash is null unless this instance was byte-verified by the kernel loader. */
  kernelPool: { id: string; sha256: string | null }[]
  bodies: AnalysisBodyEvidence[]
  physicalPredictionUncertainty: 'not-estimated'
}

export class MissingPreciseStateError extends MissingBodyStateError {
  constructor(bodyId: BodyId, julianDay: number) {
    super(bodyId, julianDay)
    this.name = 'MissingPreciseStateError'
    this.message = `Strict SPK analysis requires a covered state for ${bodyId} at UTC JD ${julianDay}; no approximate model was substituted`
  }
}

const VELOCITY_STEP_DAYS = 0.01
const MAX_CACHED_EPOCHS = 64
const FIRST_SUPPORTED_UTC_JD = 2441317.5

/** Check the declared time contract, not independent timing accuracy. */
export function matchesAnalysisTimeEvidence(evidence: AnalysisEphemerisEvidence): boolean {
  if (![evidence.startJulianDay, evidence.endJulianDay].every(Number.isFinite) || evidence.endJulianDay < evidence.startJulianDay) return false
  if (evidence.startJulianDay < FIRST_SUPPORTED_UTC_JD) {
    return evidence.dynamicalTimeScale === 'legacy-numeric-jd' && evidence.timeScaleQuality === null
  }
  const quality = evidence.timeScaleQuality
  if (evidence.dynamicalTimeScale !== 'TDB' || !quality) return false
  const expected = utcTimeScaleQuality(evidence.endJulianDay)
  // Iterate the dense expected list: Array.every on received data skips holes,
  // which could otherwise erase required assumptions while preserving length.
  const same = (actual: readonly string[], values: readonly string[]) => Array.isArray(actual) &&
    actual.length === values.length && values.every((value, index) => Object.hasOwn(actual, index) && actual[index] === value)
  return quality.scale === expected.scale && quality.status === expected.status && quality.leapSeconds === expected.leapSeconds &&
    same(quality.assumptions, expected.assumptions) && same(quality.sources, expected.sources)
}

/** One frozen model window for sampling, refinement and mission endpoints.
 * Position and velocity of precise bodies come from the same SPK evaluation.
 * The bounded epoch LRU also reuses departure states across porkchop rows. */
export function createAnalysisEphemeris(options: {
  bodiesById: Map<BodyId, CelestialBody>
  kernels: readonly LoadedKernel[]
  startJulianDay: number
  endJulianDay: number
  policy?: AnalysisEphemerisPolicy
  needsVelocity?: boolean
}) {
  const { startJulianDay, endJulianDay, needsVelocity } = options
  const policy = options.policy ?? 'prefer-spk'
  if (!['prefer-spk', 'require-spk'].includes(policy)) throw new RangeError('Unknown analysis ephemeris policy')
  if (![startJulianDay, endJulianDay].every(Number.isFinite) || endJulianDay < startJulianDay) {
    throw new RangeError('Analysis ephemeris window must be finite and ordered')
  }
  // Body records contain structured data only. Copy nested orbital elements and
  // identity metadata as well as the Map so later UI edits cannot change a scan.
  const bodiesById = structuredClone(options.bodiesById)
  const manifestId = EPHEMERIS_MANIFEST.id
  const modern = startJulianDay >= FIRST_SUPPORTED_UTC_JD
  // Preserve the documented exploratory numeric-JD contract for older models.
  // Strict SPK cannot pretend that this is a supported UTC conversion.
  const margin = needsVelocity && policy === 'prefer-spk' ? VELOCITY_STEP_DAYS : 0
  const eligibleKernels = modern && startJulianDay - margin >= FIRST_SUPPORTED_UTC_JD
    ? kernelsCoveringInterval(options.kernels, utcJulianDayToEt(startJulianDay - margin), utcJulianDayToEt(endJulianDay + margin))
    : []
  const kernels = Object.freeze(eligibleKernels.map(({ id, kernel, solutionKernelIds, dependencyOnly }) => Object.freeze({
    id, kernel, dependencyOnly,
    solutionKernelIds: solutionKernelIds === undefined ? undefined : Object.freeze(solutionKernelIds.slice()),
  })))
  const bodyEvidence = new Map<BodyId, AnalysisBodyEvidence>()
  const kernelPool = kernels.map(kernel => ({ id: kernel.id, sha256: verifiedKernelSha256(kernel) }))
  const record = (body: CelestialBody, model: AnalysisBodyModel) => {
    const previous = bodyEvidence.get(body.id)
    if (previous && previous.model !== model) throw new Error(`Analysis model changed inside its frozen window for ${body.id}`)
    bodyEvidence.set(body.id, { bodyId: body.id, model, source: body.source })
  }

  function createEpoch(julianDay: number) {
    const precise = kernels.length ? createKernelResolver(kernels, utcJulianDayToEt(julianDay)) : null
    // Fully covered SPK epochs do not need a second resolver/pool cache.
    // Construct fallback lazily; it must retain the same frozen kernel pool
    // because approximate children may still have precisely covered parents.
    let fallback: ReturnType<typeof createBodyPositionResolver> | undefined
    let before: ReturnType<typeof createBodyPositionResolver> | undefined
    let after: ReturnType<typeof createBodyPositionResolver> | undefined
    const positions = new Map<BodyId, Vector3>()
    const velocities = new Map<BodyId, Vector3>()
    const preciseStates = new Map<BodyId, ReturnType<ReturnType<typeof createKernelResolver>['relative']>>()
    const bodyAndState = (bodyId: BodyId) => {
      const body = bodiesById.get(bodyId)
      if (!body) throw new Error(`Unknown body: ${bodyId}`)
      if (body.source === 'source-inventory') throw new MissingBodyStateError(bodyId, julianDay)
      if (bodyId === 'sun') {
        record(body, 'heliocentric-origin')
        return { body, state: null }
      }
      if (!preciseStates.has(bodyId)) {
        const target = bodyNaifId(body)
        preciseStates.set(bodyId, precise && target !== undefined ? precise.relative(target, 10) : null)
      }
      const state = preciseStates.get(bodyId)!
      if (!state && policy === 'require-spk') throw new MissingPreciseStateError(bodyId, julianDay)
      return { body, state }
    }
    const position = (bodyId: BodyId): Vector3 => {
      const cached = positions.get(bodyId)
      if (cached) return cached
      const { body, state } = bodyAndState(bodyId)
      const value = bodyId === 'sun' ? { x: 0, y: 0, z: 0 } : state
        ? scaleVector3(state.position, 1 / AU_IN_KM)
        : (fallback ??= createBodyPositionResolver(bodiesById, julianDay, kernels))(bodyId)
      if (bodyId !== 'sun') record(body, state ? 'jpl-spk' : 'approximate-fallback')
      positions.set(bodyId, value)
      return value
    }
    const velocity = (bodyId: BodyId): Vector3 => {
      const cached = velocities.get(bodyId)
      if (cached) return cached
      position(bodyId)
      const { state } = bodyAndState(bodyId)
      let value: Vector3
      if (bodyId === 'sun') value = { x: 0, y: 0, z: 0 }
      else if (state) value = scaleVector3(state.velocity, SECONDS_PER_DAY / AU_IN_KM)
      else {
        if (!needsVelocity) throw new Error('Approximate velocity requires a velocity-enabled analysis window')
        const beforeJulianDay = julianDay - VELOCITY_STEP_DAYS
        const afterJulianDay = julianDay + VELOCITY_STEP_DAYS
        before ??= createBodyPositionResolver(bodiesById, beforeJulianDay, kernels)
        after ??= createBodyPositionResolver(bodiesById, afterJulianDay, kernels)
        const elapsedDays = modern
          ? (utcJulianDayToEt(afterJulianDay) - utcJulianDayToEt(beforeJulianDay)) / SECONDS_PER_DAY
          : afterJulianDay - beforeJulianDay
        if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) throw new RangeError('Approximate velocity samples have no positive dynamical time interval')
        value = scaleVector3(subtractVector3(after(bodyId), before(bodyId)), 1 / elapsedDays)
      }
      velocities.set(bodyId, value)
      return value
    }
    // Keep cache entries private; callers own each returned vector. Freeze the
    // cached query facade so one consumer cannot replace another's methods.
    return Object.freeze({
      position: (bodyId: BodyId): Vector3 => ({ ...position(bodyId) }),
      velocity: (bodyId: BodyId): Vector3 => ({ ...velocity(bodyId) }),
    })
  }
  const epochs = new Map<number, ReturnType<typeof createEpoch>>()
  const bodyModels = (ids?: readonly BodyId[]) => [...bodyEvidence.values()]
    .filter(body => !ids || ids.includes(body.bodyId))
    .sort((a, b) => a.bodyId.localeCompare(b.bodyId)).map(body => ({ ...body }))
  return {
    kernels,
    bodyModels,
    at(julianDay: number) {
      if (!Number.isFinite(julianDay) || julianDay < startJulianDay || julianDay > endJulianDay) {
        throw new RangeError('Epoch lies outside the frozen analysis window')
      }
      const epoch = epochs.get(julianDay) ?? createEpoch(julianDay)
      epochs.delete(julianDay)
      epochs.set(julianDay, epoch)
      if (epochs.size > MAX_CACHED_EPOCHS) epochs.delete(epochs.keys().next().value!)
      return epoch
    },
    elapsedDays(startUtcJd: number, endUtcJd: number) {
      if (startUtcJd < startJulianDay || endUtcJd > endJulianDay || endUtcJd <= startUtcJd || ![startUtcJd, endUtcJd].every(Number.isFinite)) {
        throw new RangeError('Flight dates must lie in the analysis window and be ordered')
      }
      return modern ? (utcJulianDayToEt(endUtcJd) - utcJulianDayToEt(startUtcJd)) / SECONDS_PER_DAY : endUtcJd - startUtcJd
    },
    evidence(): AnalysisEphemerisEvidence {
      return {
        schemaVersion: 1, policy, inputTimeScale: 'UTC', dynamicalTimeScale: modern ? 'TDB' : 'legacy-numeric-jd',
        timeScaleQuality: modern ? utcTimeScaleQuality(endJulianDay) : null,
        frame: 'ECLIPJ2000', origin: 'Sun', positionUnit: 'AU', velocityUnit: 'AU/d',
        startJulianDay, endJulianDay, manifestId,
        kernelPool: kernelPool.map(file => ({ ...file })),
        bodies: bodyModels(),
        physicalPredictionUncertainty: 'not-estimated',
      }
    },
  }
}
