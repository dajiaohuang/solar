import { createDe440Dynamics } from './de440Dynamics.ts'
import { integrateAdaptive } from './adaptiveIntegrator.ts'
import { withIdentityTransition } from './pointMassGravity.ts'

export function parseDynamicsInitial(value: unknown) {
  const input = value as Record<string, unknown> | null
  if (!input || input.schemaVersion !== 1 || input.frame !== 'J2000' || input.origin !== 'SSB' || input.timeScale !== 'TDB' ||
      typeof input.referenceEpochTdb !== 'number' || !Number.isFinite(input.referenceEpochTdb) || !Array.isArray(input.initial) || input.initial.length !== 6 || !input.initial.every(v => typeof v === 'number' && Number.isFinite(v)) ||
      typeof input.initialSource !== 'string' || !input.initialSource.trim()) throw new RangeError('Expected explicit J2000/SSB/TDB initial state in km and km/s with source description')
  return { payload: input, referenceEpochTdb: input.referenceEpochTdb, initial: input.initial as number[], initialSource: input.initialSource }
}

export async function integrateDynamicsExperiment(dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>, initial: number[], durationSeconds: number, signal?: AbortSignal) {
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400) throw new RangeError('Experiment duration must be within 365 days')
  const absoluteTolerance = new Float64Array(42).fill(1e-12)
  absoluteTolerance.fill(1e-5, 0, 3)
  const { state, ...numerics } = await integrateAdaptive({ initial: withIdentityTransition(initial), duration: durationSeconds,
    derivative: dynamics.derivative, absoluteTolerance, relativeTolerance: 1e-12, initialStep: 3600, maxStep: 86400, maxAttempts: 20000, signal })
  return { forceModel: dynamics.evidence,
    finalEpoch: { referenceEpochTdb: dynamics.evidence.referenceEpochTdb, elapsedTdbSeconds: durationSeconds },
    finalStateKmKmPerSecond: Array.from(state.subarray(0, 6)),
    transitionMatrix: { layout: 'row-major; d(final J2000 SSB state)/d(initial J2000 SSB state)', dimension: 6, values: Array.from(state.subarray(6)) },
    numerics: { ...numerics, absoluteTolerance: Array.from(numerics.absoluteTolerance) },
    uncertainty: 'Not computed. A fixed-parameter transition matrix is not the complete source-fit covariance.' }
}
