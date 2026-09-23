import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import { cartesianCovarianceAtSolutionEpoch, type AdoptedSolarGM } from './orbitCovariance'
import { propagatePeriapsisConic } from './conicPeriapsis'

const AU = 149597870.7, DAY = 86400, DEG = Math.PI/180

/** Nonlinear source-parameter coordinate conversion, not force integration.
 * Invalid draws retain their index and offsets; none are clipped or resampled. */
export async function cartesianStatesFromSourceOffsets(input: SbdbCovariance, adopted: AdoptedSolarGM, offsets: Float64Array, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const dimension = input.labels.length
  if (dimension < 6 || dimension > 16 || offsets.length % dimension || offsets.length < dimension || offsets.length > 10000*dimension || !offsets.every(Number.isFinite)) {
    throw new RangeError('Expected 1 to 10000 finite joint source-offset vectors')
  }
  const source = structuredClone(input), gm = { ...adopted }, draws = offsets.slice()
  // Reuse the audited source-axis/unit/domain validation, not its linear map.
  const nominal = cartesianCovarianceAtSolutionEpoch(source, gm)
  const axes = ['e','q','tp','node','peri','i'].map(label => source.labels.indexOf(label))
  const count = draws.length/dimension, states = new Float64Array(count*6).fill(NaN)
  const additionalValues = new Float64Array(count*(dimension-6)).fill(NaN)
  const valid = new Uint8Array(count), failures: { index: number; reason: string }[] = []
  for (let index = 0; index < count; index++) {
    if (index % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted() }
    const value = (axis: number) => source.nominal[axes[axis]]+draws[index*dimension+axes[axis]]
    // Never add a tiny tp offset to a multi-million-day Julian date.
    const elapsedDays = (source.solutionEpochTdb-source.nominal[axes[2]])-draws[index*dimension+axes[2]]
    try {
      const result = propagatePeriapsisConic({ periapsisKm: value(1)*AU, eccentricity: value(0),
        gmKm3PerSecond2: gm.au3PerDay2*AU**3/DAY**2, inclinationRadians: value(5)*DEG,
        ascendingNodeRadians: value(3)*DEG, argumentOfPeriapsisRadians: value(4)*DEG }, elapsedDays*DAY)
      const state = [result.positionKm.x/AU,result.positionKm.y/AU,result.positionKm.z/AU,
        result.velocityKmPerSecond.x*DAY/AU,result.velocityKmPerSecond.y*DAY/AU,result.velocityKmPerSecond.z*DAY/AU]
      const extras = source.nominal.slice(6).map((v,j) => v+draws[index*dimension+6+j])
      if (![...state,...extras].every(Number.isFinite)) throw new RangeError('Sample exceeds numeric range')
      states.set(state,index*6); additionalValues.set(extras,index*(dimension-6)); valid[index] = 1
    } catch (error) { failures.push({ index, reason: error instanceof Error ? error.message : String(error) }) }
  }
  signal?.throwIfAborted()
  return { source, adoptedSolarGM: gm, offsets: draws, count, dimension, states, additionalValues, valid, failures,
    frame: source.frame, epochTdb: source.solutionEpochTdb,
    stateLabels: nominal.labels.slice(0,6), stateUnits: nominal.units.slice(0,6),
    additionalLabels: source.labels.slice(6), additionalUnits: source.units.slice(6),
    method: 'nonlinear-source-offsets-to-periapsis-conic-state-v1',
    limitations: ['Coordinate conversion at the solution epoch only; no force-model propagation or event probabilities.',
      'Conditional on adopted solar GM. Additional fitted parameters are retained without applying their forces.',
      'Invalid draws have valid=0 and NaN packed values; original offsets and failure reasons are retained. Never omit them when interpreting distributions.',
      'Original source and offsets are Float64; relative tp evaluation avoids an additional large-Julian-date rounding step.'] }
}
