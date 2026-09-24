import { createDe440Dynamics } from './de440Dynamics.ts'
import { integrateAdaptive } from './adaptiveIntegrator.ts'
import { withIdentityTransition } from './pointMassGravity.ts'
import { createTrajectoryRecorder } from './trajectorySamples.ts'
import { orbitalTimescaleComparison, stateToConicDiagnostics } from '../ephemeris/osculating.ts'
import { parseSolarRadiationPressure } from './solarRadiationPressure.ts'

export function parseDynamicsInitial(value: unknown) {
  // Own the complete source record, including optional provenance metadata.
  const input = structuredClone(value) as Record<string, unknown> | null
  if (!input || input.schemaVersion !== 1 || input.frame !== 'J2000' || input.origin !== 'SSB' || input.timeScale !== 'TDB' ||
      typeof input.referenceEpochTdb !== 'number' || !Number.isFinite(input.referenceEpochTdb) || !Array.isArray(input.initial) || input.initial.length !== 6 || !input.initial.every(v => typeof v === 'number' && Number.isFinite(v)) ||
      typeof input.initialSource !== 'string' || !input.initialSource.trim()) throw new RangeError('Expected explicit J2000/SSB/TDB initial state in km and km/s with source description')
  const solarRadiationPressure = input.solarRadiationPressure === undefined ? undefined : parseSolarRadiationPressure(input.solarRadiationPressure)
  return { payload: input, referenceEpochTdb: input.referenceEpochTdb, initial: [...input.initial] as number[], initialSource: input.initialSource, solarRadiationPressure }
}

export async function integrateDynamicsExperiment(dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>, initial: number[], durationSeconds: number, signal?: AbortSignal, compareRefinement = false) {
  signal?.throwIfAborted()
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365 * 86400) throw new RangeError('Experiment duration must be within 365 days')
  if (typeof compareRefinement !== 'boolean') throw new RangeError('Refinement adoption must be boolean')
  // Both integrations and every sample must describe the same run, even when
  // callers change their objects while the integrator yields to the event loop.
  const initialState = withIdentityTransition(initial)
  const evidence = structuredClone(dynamics.evidence), stateAt = dynamics.state, derivative = dynamics.derivative
  if (durationSeconds < evidence.elapsedRangeSeconds[0] || durationSeconds > evidence.elapsedRangeSeconds[1]) throw new RangeError('Experiment endpoint is outside the frozen force window')
  const absoluteTolerance = new Float64Array(42).fill(1e-12)
  absoluteTolerance.fill(1e-5, 0, 3)
  const solarGm = evidence.masses.find(mass => mass.naifId === 10)!.gmKm3PerSecond2
  const sample = (elapsed: number, state: ArrayLike<number>) => {
    const sun = stateAt(10, elapsed)
    const relative = Array.from({ length: 6 }, (_, i) => state[i]-sun[i])
    return { elapsedTdbSeconds: elapsed, stateKmKmPerSecond: Array.from(state).slice(0, 6),
      sunStateKmKmPerSecond: Array.from(sun),
      heliocentricPositionKm: relative.slice(0, 3), heliocentricVelocityKmPerSecond: relative.slice(3),
      osculating: stateToConicDiagnostics({ x: relative[0], y: relative[1], z: relative[2] }, { x: relative[3], y: relative[4], z: relative[5] }, solarGm) }
  }
  const initialSample = sample(0, initialState)
  const trajectory = createTrajectoryRecorder(initialSample)
  const { state, ...numerics } = await integrateAdaptive({ initial: initialState, duration: durationSeconds,
    derivative, absoluteTolerance, relativeTolerance: 1e-12, initialStep: 3600, maxStep: 86400, maxAttempts: 20000, signal,
    onAcceptedStep: (elapsed, state) => trajectory.accept(() => sample(elapsed, state)) })
  let refinement = null
  if (compareRefinement) {
    const refined = await integrateAdaptive({ initial: initialState, duration: durationSeconds,
      derivative, absoluteTolerance: absoluteTolerance.map(value => value/10), relativeTolerance: 1e-13,
      initialStep: 1800, maxStep: 43200, maxAttempts: 20000, signal })
    refinement = { relativeTolerance: refined.relativeTolerance, absoluteTolerance: Array.from(refined.absoluteTolerance),
      initialStep: refined.initialStep, maxStep: refined.maxStep, maxAttempts: refined.maxAttempts,
      accepted: refined.accepted, rejected: refined.rejected, attempts: refined.attempts, evaluations: refined.evaluations,
      smallestAcceptedStep: refined.smallestAcceptedStep, largestAcceptedStep: refined.largestAcceptedStep,
      maxAcceptedErrorRatio: refined.maxAcceptedErrorRatio,
      finalStateKmKmPerSecond: Array.from(refined.state.subarray(0, 6)),
      transitionMatrixValues: Array.from(refined.state.subarray(6)),
      endpointPositionDifferenceKm: Math.hypot(...Array.from(state.subarray(0, 3), (value, i) => value-refined.state[i])),
      endpointVelocityDifferenceKmPerSecond: Math.hypot(...Array.from(state.subarray(3, 6), (value, i) => value-refined.state[i+3])),
      maxNormalizedTransitionDifference: Math.max(...Array.from(state.subarray(6), (value, i) => Math.abs(value-refined.state[i+6])/(1+Math.abs(refined.state[i+6])))),
      limitation: 'Agreement between two numerical settings of the same force model; not a global error bound or physical uncertainty.' }
  }
  signal?.throwIfAborted()
  return { forceModel: evidence,
    diagnostics: { model: 'instantaneous-newtonian-solar-conic', frame: 'J2000', origin: 'Sun', solarGmKm3PerSecond2: solarGm,
      timescaleComparison: orbitalTimescaleComparison(durationSeconds, initialSample.osculating?.orbitalPeriodSeconds ?? null),
      limitation: 'Sampled osculating diagnostics, not conserved quantities of the perturbed/1PN model, collision predictions, resonance classification or long-term stability proof. Null values indicate undefined, ill-conditioned or numerically unrepresentable diagnostics; near-parabolic classification uses 32 machine epsilons, not physical uncertainty.' },
    trajectory: trajectory.finish(sample(durationSeconds, state)), refinement,
    finalEpoch: { referenceEpochTdb: evidence.referenceEpochTdb, elapsedTdbSeconds: durationSeconds },
    finalStateKmKmPerSecond: Array.from(state.subarray(0, 6)),
    transitionMatrix: { layout: 'row-major; d(final J2000 SSB state)/d(initial J2000 SSB state)', dimension: 6, values: Array.from(state.subarray(6)) },
    numerics: { ...numerics, absoluteTolerance: Array.from(numerics.absoluteTolerance) },
    uncertainty: 'Not computed. A fixed-parameter transition matrix is not the complete source-fit covariance.' }
}
