import { orbitalTimescaleComparison, stateToConicDiagnostics } from '../engine/ephemeris/osculating.ts'
import { checkTransitionMatrixIntegrity } from '../engine/dynamics/transitionMatrixIntegrity.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid integration receipt record')
  return value as Record<string, unknown>
}
const finite = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Nonfinite integration diagnostic')
  return value
}
const integer = (value: unknown, max: number): number => {
  const number = finite(value)
  if (!Number.isSafeInteger(number) || number < 0 || number > max) throw new Error('Integration diagnostic exceeds its count budget')
  return number
}
const state = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length !== 6) throw new Error('Expected six integration state entries')
  return Array.from(value, finite)
}
const transitionValues = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length !== 36) throw new Error('Expected 36 finite transition entries')
  return Array.from(value, finite)
}
const same = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Integration endpoint or diagnostic mismatch')
}

/** Bounded bookkeeping and endpoint binding, not reintegration or accuracy proof. */
export async function checkIntegrationReceipt(experiment: Record<string, unknown>, duration: number, initial?: unknown) {
  const checkCounts = (value: unknown, maxStep: number) => {
    const n = record(value), accepted = integer(n.accepted,20000), rejected = integer(n.rejected,20000)
    const attempts = integer(n.attempts,20000)
    same(attempts,accepted+rejected)
    same(integer(n.evaluations,120001),duration === 0 ? 0 : 1+6*attempts)
    const largest = finite(n.largestAcceptedStep), error = finite(n.maxAcceptedErrorRatio)
    if (duration === 0) {
      same(accepted,0); same(rejected,0); same(largest,0); same(error,0); same(n.smallestAcceptedStep,null)
    } else {
      const smallest = finite(n.smallestAcceptedStep)
      if (accepted < 1 || smallest <= 0 || smallest > largest || largest > maxStep || error < 0 || error > 1) throw new Error('Invalid accepted-step diagnostics')
    }
    return accepted
  }
  const numerics = record(experiment.numerics)
  same(numerics.algorithm,'dormand-prince-54-component-max-v1'); same(numerics.elapsed,duration)
  same(numerics.relativeTolerance,1e-12); same(numerics.initialStep,3600); same(numerics.maxStep,86400); same(numerics.maxAttempts,20000)
  same(numerics.absoluteTolerance,Array.from({ length: 42 }, (_, i) => i < 3 ? 1e-5 : 1e-12))
  const accepted = checkCounts(numerics,86400), endpoint = state(experiment.finalStateKmKmPerSecond)
  const force = record(experiment.forceModel), diagnostics = record(experiment.diagnostics)
  if (!Array.isArray(force.masses)) throw new Error('Diagnostic force source missing')
  const solar = force.masses.map(record).find(mass => mass.naifId === 10)
  const gm = finite(solar?.gmKm3PerSecond2)
  if (gm <= 0) throw new Error('Invalid diagnostic solar GM')
  same(diagnostics.model,'instantaneous-newtonian-solar-conic'); same(diagnostics.frame,'J2000'); same(diagnostics.origin,'Sun')
  same(diagnostics.solarGmKm3PerSecond2,gm)
  if (typeof diagnostics.limitation !== 'string' || !diagnostics.limitation.trim()) throw new Error('Diagnostic limitation missing')
  const transition = record(experiment.transitionMatrix)
  same(transition.dimension,6)
  same(transition.layout,'row-major; d(final J2000 SSB state)/d(initial J2000 SSB state)')
  const primaryTransition = transitionValues(transition.values)
  await checkTransitionMatrixIntegrity(primaryTransition,transition.integrity)
  const trajectory = record(experiment.trajectory), samples = trajectory.samples
  same(trajectory.acceptedSteps,accepted); same(trajectory.maxNodes,2048)
  if (!Array.isArray(samples) || !samples.length || samples.length > 2048) throw new Error('Invalid bounded integration trajectory')
  same(trajectory.retainedNodes,samples.length)
  let expectedStride = 1
  while (Math.floor(accepted/expectedStride)+1 > 2048) expectedStride *= 2
  same(trajectory.stride,expectedStride)
  const expectedIndices = Array.from({ length: Math.floor(accepted/expectedStride)+1 }, (_, index) => index*expectedStride)
  if (expectedIndices[expectedIndices.length-1] !== accepted) {
    if (expectedIndices.length === 2048) expectedIndices.pop()
    expectedIndices.push(accepted)
  }
  same(trajectory.acceptedStepIndices,expectedIndices); same(samples.length,expectedIndices.length)
  same(trajectory.selection,'Every stride-th accepted endpoint plus initial/final endpoints; the final endpoint may replace the last sampled node at capacity; no interpolation')
  const first = record(samples[0]), last = record(samples[samples.length-1])
  same(first.elapsedTdbSeconds,0); same(last.elapsedTdbSeconds,duration)
  same(state(last.stateKmKmPerSecond),endpoint)
  if (initial !== undefined) same(state(first.stateKmKmPerSecond),state(initial))
  let previous = 0
  for (let index = 0; index < samples.length; index++) {
    const sample = record(samples[index]), elapsed = finite(sample.elapsedTdbSeconds)
    const barycentric = state(sample.stateKmKmPerSecond), sun = state(sample.sunStateKmKmPerSecond)
    const relative = barycentric.map((value,i) => finite(value-sun[i]))
    same(sample.heliocentricPositionKm,relative.slice(0,3))
    same(sample.heliocentricVelocityKmPerSecond,relative.slice(3))
    const osculating = stateToConicDiagnostics(
      { x: relative[0], y: relative[1], z: relative[2] },
      { x: relative[3], y: relative[4], z: relative[5] },gm)
    same(sample.osculating,osculating)
    if (index === 0) same(diagnostics.timescaleComparison,orbitalTimescaleComparison(duration,osculating?.orbitalPeriodSeconds ?? null))
    if (elapsed < Math.min(0,duration) || elapsed > Math.max(0,duration) ||
        index > 0 && (duration === 0 || Math.sign(duration)*(elapsed-previous) <= 0)) throw new Error('Integration trajectory times are not ordered within the request')
    previous = elapsed
  }
  if (experiment.refinement !== null) {
    const refined = record(experiment.refinement)
    checkCounts(refined,43200)
    const refinedState = state(refined.finalStateKmKmPerSecond), refinedTransition = transitionValues(refined.transitionMatrixValues)
    await checkTransitionMatrixIntegrity(refinedTransition,refined.transitionMatrixIntegrity)
    const positionDifference = Math.hypot(...endpoint.slice(0,3).map((value,i) => value-refinedState[i]))
    const velocityDifference = Math.hypot(...endpoint.slice(3,6).map((value,i) => value-refinedState[i+3]))
    const transitionDifference = Math.max(...primaryTransition.map((value,i) => Math.abs(value-refinedTransition[i])/(1+Math.abs(refinedTransition[i]))))
    same(finite(refined.endpointPositionDifferenceKm),finite(positionDifference))
    same(finite(refined.endpointVelocityDifferenceKmPerSecond),finite(velocityDifference))
    same(finite(refined.maxNormalizedTransitionDifference),finite(transitionDifference))
  }
}
