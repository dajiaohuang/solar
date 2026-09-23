import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import type { createDe440Dynamics } from './de440Dynamics'
import { cartesianCovarianceAtSolutionEpoch } from '../ephemeris/orbitCovariance.ts'
import { factorSbdbCovariance } from '../ephemeris/covarianceSampling.ts'
import { integrateDynamicsExperiment } from './experiment.ts'

const AU = 149597870.7, DAY = 86400, obliquity = 84381.448/3600*Math.PI/180
const c = Math.cos(obliquity), s = Math.sin(obliquity)
// Fixed NAIF ECLIPJ2000 -> J2000 rotation, applied independently to r and v.
const rotation = [[1,0,0], [0,c,-s], [0,s,c]]
const multiply = (a: number[][], b: number[][]) => a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => sum+value*b[k][j], 0)))
const transpose = (a: number[][]) => a[0].map((_, j) => a.map(row => row[j]))

export async function propagateDynamicsCovariance(dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>, input: SbdbCovariance, durationSeconds: number, signal?: AbortSignal) {
  // Freeze the audited input before integration can yield to a caller.
  const source = structuredClone(input)
  if (source.labels.length !== 6 || source.additionalParameters.length !== 0) throw new RangeError('Covariance propagation requires matched force derivatives for every additional source parameter; none may be dropped or held fixed implicitly')
  if (source.solutionEpochTdb !== dynamics.evidence.referenceEpochTdb) throw new RangeError('Dynamics must start at the covariance solution epoch')
  const solar = dynamics.evidence.masses.find(mass => mass.naifId === 10)!
  const initialCoordinates = cartesianCovarianceAtSolutionEpoch(source, {
    au3PerDay2: solar.gmKm3PerSecond2*DAY**2/AU**3, source: solar.gmSource })
  const { lower, sigmas } = factorSbdbCovariance(source)
  const sourceRoot = lower.map((row, i) => row.map(value => value*sigmas[i]))
  const transform = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.floor(i/3) === Math.floor(j/3) ? rotation[i%3][j%3]*AU/(i < 3 ? 1 : DAY) : 0))
  const inverse = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.floor(i/3) === Math.floor(j/3) ? rotation[j%3][i%3]*(i < 3 ? 1 : DAY)/AU : 0))
  const initialRoot = multiply(transform, multiply(initialCoordinates.jacobian, sourceRoot))
  const sun = dynamics.state(10, 0)
  const initialState = multiply(transform, initialCoordinates.nominal.map(value => [value])).map((row, i) => row[0]+sun[i])
  const experiment = await integrateDynamicsExperiment(dynamics, initialState, durationSeconds, signal)
  const phi = Array.from({ length: 6 }, (_, i) => experiment.transitionMatrix.values.slice(i*6, i*6+6))
  const finalRoot = multiply(inverse, multiply(phi, initialRoot))
  // C = B B^T avoids subtracting nearly equal terms in Phi C Phi^T.
  const matrix = multiply(finalRoot, transpose(finalRoot))
  const finalSun = dynamics.state(10, durationSeconds)
  const nominal = multiply(inverse, experiment.finalStateKmKmPerSecond.map((value, i) => [value-finalSun[i]])).map(row => row[0])
  if (![...nominal, ...matrix.flat(), ...finalRoot.flat()].every(Number.isFinite)) throw new RangeError('Propagated covariance exceeds the numerical range')
  return { source, initialCoordinates, experiment: { ...experiment,
    uncertainty: 'Conditional six-parameter first-order covariance is reported in finalCoordinates; the complete source-fit uncertainty and model error are not computed.' },
    finalCoordinates: { frame: source.frame, labels: initialCoordinates.labels, units: initialCoordinates.units,
      epoch: experiment.finalEpoch, nominal, matrix, squareRoot: finalRoot, marginalSigmas: matrix.map((row, i) => Math.sqrt(row[i])) },
    method: 'first-order-variational-square-root-pushforward',
    limitations: ['Conditional on the explicitly adopted restricted force model and fixed DE440 masses, trajectories and solar GM.',
      'Not propagation of the complete SBDB orbit-fit model; model mismatch and ephemeris/GM uncertainty are not included.',
      'Only six-parameter sources are currently supported. Additional fitted or considered force parameters require matched derivatives.',
      'First-order Gaussian covariance, not a nonlinear ensemble, event probability or physical-accuracy guarantee.',
      'The deterministic Sun translation contributes no additional covariance. Output uses heliocentric IAU76/80 J2000 ecliptic AU and AU/day.'] }
}
