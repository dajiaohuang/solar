import { createDe440Dynamics } from './de440Dynamics.ts'
import { integrateAdaptive } from './adaptiveIntegrator.ts'
import { withIdentityTransition } from './pointMassGravity.ts'
import { createTrajectoryRecorder } from './trajectorySamples.ts'

export function parseDynamicsInitial(value: unknown) {
  const input = value as Record<string, unknown> | null
  if (!input || input.schemaVersion !== 1 || input.frame !== 'J2000' || input.origin !== 'SSB' || input.timeScale !== 'TDB' ||
      typeof input.referenceEpochTdb !== 'number' || !Number.isFinite(input.referenceEpochTdb) || !Array.isArray(input.initial) || input.initial.length !== 6 || !input.initial.every(v => typeof v === 'number' && Number.isFinite(v)) ||
      typeof input.initialSource !== 'string' || !input.initialSource.trim()) throw new RangeError('Expected explicit J2000/SSB/TDB initial state in km and km/s with source description')
  return { payload: input, referenceEpochTdb: input.referenceEpochTdb, initial: input.initial as number[], initialSource: input.initialSource }
}

export async function integrateDynamicsExperiment(dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>, initial: number[], durationSeconds: number, signal?: AbortSignal, compareRefinement = false) {
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400) throw new RangeError('Experiment duration must be within 365 days')
  const absoluteTolerance = new Float64Array(42).fill(1e-12)
  absoluteTolerance.fill(1e-5, 0, 3)
  const sample = (elapsed: number, state: ArrayLike<number>) => {
    const sun = dynamics.state(10, elapsed)
    return { elapsedTdbSeconds: elapsed, stateKmKmPerSecond: Array.from(state).slice(0, 6),
      heliocentricPositionKm: [state[0]-sun[0], state[1]-sun[1], state[2]-sun[2]] }
  }
  const trajectory = createTrajectoryRecorder(sample(0, initial))
  const { state, ...numerics } = await integrateAdaptive({ initial: withIdentityTransition(initial), duration: durationSeconds,
    derivative: dynamics.derivative, absoluteTolerance, relativeTolerance: 1e-12, initialStep: 3600, maxStep: 86400, maxAttempts: 20000, signal,
    onAcceptedStep: (elapsed, state) => trajectory.accept(() => sample(elapsed, state)) })
  let refinement = null
  if (compareRefinement) {
    const refined = await integrateAdaptive({ initial: withIdentityTransition(initial), duration: durationSeconds,
      derivative: dynamics.derivative, absoluteTolerance: absoluteTolerance.map(value => value/10), relativeTolerance: 1e-13,
      initialStep: 1800, maxStep: 43200, maxAttempts: 20000, signal })
    refinement = { relativeTolerance: refined.relativeTolerance, absoluteTolerance: Array.from(refined.absoluteTolerance),
      initialStep: refined.initialStep, maxStep: refined.maxStep, maxAttempts: refined.maxAttempts,
      accepted: refined.accepted, evaluations: refined.evaluations,
      finalStateKmKmPerSecond: Array.from(refined.state.subarray(0, 6)),
      transitionMatrixValues: Array.from(refined.state.subarray(6)),
      endpointPositionDifferenceKm: Math.hypot(...Array.from(state.subarray(0, 3), (value, i) => value-refined.state[i])),
      endpointVelocityDifferenceKmPerSecond: Math.hypot(...Array.from(state.subarray(3, 6), (value, i) => value-refined.state[i+3])),
      maxNormalizedTransitionDifference: Math.max(...Array.from(state.subarray(6), (value, i) => Math.abs(value-refined.state[i+6])/(1+Math.abs(refined.state[i+6])))),
      limitation: 'Agreement between two numerical settings of the same force model; not a global error bound or physical uncertainty.' }
  }
  return { forceModel: dynamics.evidence,
    trajectory: trajectory.finish(sample(durationSeconds, state)), refinement,
    finalEpoch: { referenceEpochTdb: dynamics.evidence.referenceEpochTdb, elapsedTdbSeconds: durationSeconds },
    finalStateKmKmPerSecond: Array.from(state.subarray(0, 6)),
    transitionMatrix: { layout: 'row-major; d(final J2000 SSB state)/d(initial J2000 SSB state)', dimension: 6, values: Array.from(state.subarray(6)) },
    numerics: { ...numerics, absoluteTolerance: Array.from(numerics.absoluteTolerance) },
    uncertainty: 'Not computed. A fixed-parameter transition matrix is not the complete source-fit covariance.' }
}
