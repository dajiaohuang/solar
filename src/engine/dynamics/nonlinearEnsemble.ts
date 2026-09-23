import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import type { createDe440Dynamics } from './de440Dynamics'
import { cartesianStatesFromSourceOffsets } from '../ephemeris/covarianceStateSamples'
import { integrateAdaptive } from './adaptiveIntegrator'
import { summarizeEnsembleEndpoints } from './ensembleMoments'

const AU = 149597870.7, DAY = 86400
const angle = 84381.448/3600*Math.PI/180, c = Math.cos(angle), s = Math.sin(angle)
const MAX_EVALUATIONS = 250000

/** Finite joint-source draws under an explicit restricted force model.
 * Invalid samples retain their identities. No probability estimate is made. */
export async function propagateSourceOffsetEnsemble(
  dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>, input: SbdbCovariance,
  offsets: Float64Array, durationSeconds: number, signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (input.labels.length !== 6 || input.additionalParameters.length !== 0) throw new RangeError('Nonlinear propagation requires matched forces for every additional source parameter')
  if (offsets.length < 6 || offsets.length > 128*6 || offsets.length % 6) throw new RangeError('Nonlinear propagation accepts 1 to 128 joint source draws')
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds) > 365*DAY) throw new RangeError('Ensemble duration must be within 365 days')
  const evidence = structuredClone(dynamics.evidence), stateAt = dynamics.state, derivative = dynamics.derivative
  if (input.solutionEpochTdb !== evidence.referenceEpochTdb) throw new RangeError('Dynamics must start at the covariance solution epoch')
  if (durationSeconds < evidence.elapsedRangeSeconds[0] || durationSeconds > evidence.elapsedRangeSeconds[1]) throw new RangeError('Ensemble endpoint is outside the frozen force window')
  const solar = evidence.masses.find(mass => mass.naifId === 10)!
  const sun0 = stateAt(10, 0), sun1 = stateAt(10, durationSeconds)
  const initial = await cartesianStatesFromSourceOffsets(input, {
    au3PerDay2: solar.gmKm3PerSecond2*DAY**2/AU**3, source: solar.gmSource,
  }, offsets, signal)
  const finalStates = new Float64Array(initial.count*6).fill(NaN), valid = initial.valid.slice()
  const failures = initial.failures.map(value => ({ ...value, stage: 'coordinates' as 'coordinates' | 'integration' }))
  const numerics: { index: number; evaluations: number; accepted: number; rejected: number }[] = []
  const integrationSettings = { algorithm: 'dormand-prince-54-component-max-v1',
    absoluteTolerance: [1e-5,1e-5,1e-5,1e-12,1e-12,1e-12], relativeTolerance: 1e-12,
    initialStep: 3600, maxStep: DAY, maxAttempts: 20000 }
  let evaluations = 0
  const budgetError = new RangeError('Ensemble exhausted its shared 250000 force-evaluation budget')
  for (let index = 0; index < initial.count; index++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    signal?.throwIfAborted()
    if (!valid[index]) continue
    const sample = initial.states.subarray(index*6,index*6+6), barycentric = new Float64Array(6)
    for (const start of [0,3]) {
      const scale = AU/(start === 0 ? 1 : DAY)
      barycentric[start] = sample[start]*scale+sun0[start]
      barycentric[start+1] = (c*sample[start+1]-s*sample[start+2])*scale+sun0[start+1]
      barycentric[start+2] = (s*sample[start+1]+c*sample[start+2])*scale+sun0[start+2]
    }
    try {
      const result = await integrateAdaptive({ initial: barycentric, duration: durationSeconds,
        derivative: (time, state, output) => {
          if (evaluations >= MAX_EVALUATIONS) throw budgetError
          evaluations++; derivative(time, state, output)
        }, ...integrationSettings, signal })
      const relative = result.state.map((value,i) => value-sun1[i]), final = new Float64Array(6)
      for (const start of [0,3]) {
        const scale = (start === 0 ? 1 : DAY)/AU
        final[start] = relative[start]*scale
        final[start+1] = (c*relative[start+1]+s*relative[start+2])*scale
        final[start+2] = (-s*relative[start+1]+c*relative[start+2])*scale
      }
      if (!final.every(Number.isFinite)) throw new RangeError('Ensemble endpoint exceeds numeric range')
      finalStates.set(final,index*6)
      numerics.push({ index, evaluations: result.evaluations, accepted: result.accepted, rejected: result.rejected })
    } catch (error) {
      signal?.throwIfAborted()
      if (error === budgetError) throw error
      valid[index] = 0
      failures.push({ index, stage: 'integration', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  signal?.throwIfAborted()
  return { initial, finalStates, valid, failures, moments: summarizeEnsembleEndpoints(finalStates,valid), numerics, integrationSettings, evaluations, maxEvaluations: MAX_EVALUATIONS,
    forceModel: evidence, frame: initial.frame, units: initial.stateUnits,
    finalEpoch: { referenceEpochTdb: initial.epochTdb, elapsedTdbSeconds: durationSeconds },
    method: 'nonlinear-joint-source-offsets-restricted-dynamics-v1',
    limitations: ['Conditional on fixed DE440 inputs and the explicitly adopted restricted force model; not the complete source orbit-fit model.',
      'Only six-parameter sources are supported; additional fitted force parameters must not be dropped.',
      'Failed draws retain original offsets and indices with valid=0 and NaN endpoints. Never silently omit them from probability denominators.',
      'Finite ensemble endpoints only; no event search, probability, uncertainty calibration or continuous collision detection.',
      'Numerical tolerances are not physical orbit error bounds.'] }
}
