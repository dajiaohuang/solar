import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import type { createDe440Dynamics } from './de440Dynamics'
import { cartesianCovarianceAtSolutionEpoch } from '../ephemeris/orbitCovariance.ts'
import { factorSbdbCovariance } from '../ephemeris/covarianceSampling.ts'
import { integrateDynamicsExperiment } from './experiment.ts'
import { orbitalPeriodUncertainty } from '../ephemeris/orbitalPeriodUncertainty.ts'
import { compensatedMatrixProduct, COVARIANCE_MATRIX_ARITHMETIC } from '../numerics/compensatedMatrixProduct.ts'

const AU = 149597870.7, DAY = 86400, obliquity = 84381.448/3600*Math.PI/180
const c = Math.cos(obliquity), s = Math.sin(obliquity)
// Fixed NAIF ECLIPJ2000 -> J2000 rotation, applied independently to r and v.
const rotation = [[1,0,0], [0,c,-s], [0,s,c]]
const transpose = (a: number[][]) => a[0].map((_, j) => a.map(row => row[j]))

export async function propagateDynamicsCovariance(dynamics: Awaited<ReturnType<typeof createDe440Dynamics>>, input: SbdbCovariance, durationSeconds: number, signal?: AbortSignal, compareRefinement = false) {
  signal?.throwIfAborted()
  if (typeof compareRefinement !== 'boolean') throw new RangeError('Covariance refinement adoption must be boolean')
  // Freeze the audited input before integration can yield to a caller.
  const source = structuredClone(input)
  const frozenDynamics = { ...dynamics, evidence: structuredClone(dynamics.evidence) }
  if (source.labels.length !== 6 || source.additionalParameters.length !== 0) throw new RangeError('Covariance propagation requires matched force derivatives for every additional source parameter; none may be dropped or held fixed implicitly')
  if (source.solutionEpochTdb !== frozenDynamics.evidence.referenceEpochTdb) throw new RangeError('Dynamics must start at the covariance solution epoch')
  const solar = frozenDynamics.evidence.masses.find(mass => mass.naifId === 10)!
  const solarGmAu3PerDay2 = solar.gmKm3PerSecond2*DAY**2/AU**3
  const initialCoordinates = cartesianCovarianceAtSolutionEpoch(source, {
    au3PerDay2: solar.gmKm3PerSecond2*DAY**2/AU**3, source: solar.gmSource })
  const { lower, sigmas, factorization } = factorSbdbCovariance(source)
  const sourceRoot = lower.map((row, i) => row.map(value => value*sigmas[i]))
  const transform = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.floor(i/3) === Math.floor(j/3) ? rotation[i%3][j%3]*AU/(i < 3 ? 1 : DAY) : 0))
  const inverse = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.floor(i/3) === Math.floor(j/3) ? rotation[j%3][i%3]*(i < 3 ? 1 : DAY)/AU : 0))
  const initialCoordinateRoot = compensatedMatrixProduct(initialCoordinates.jacobian, sourceRoot)
  const initialRoot = compensatedMatrixProduct(transform, initialCoordinateRoot)
  const sun = frozenDynamics.state(10, 0)
  const initialState = compensatedMatrixProduct(transform, initialCoordinates.nominal.map(value => [value])).map((row, i) => row[0]+sun[i])
  const experiment = await integrateDynamicsExperiment(frozenDynamics, initialState, durationSeconds, signal, compareRefinement)
  const phi = Array.from({ length: 6 }, (_, i) => experiment.transitionMatrix.values.slice(i*6, i*6+6))
  const finalRoot = compensatedMatrixProduct(inverse, compensatedMatrixProduct(phi, initialRoot))
  // C = B B^T avoids subtracting nearly equal terms in Phi C Phi^T.
  const matrix = compensatedMatrixProduct(finalRoot, transpose(finalRoot))
  const finalSun = frozenDynamics.state(10, durationSeconds)
  const nominal = compensatedMatrixProduct(inverse, experiment.finalStateKmKmPerSecond.map((value, i) => [value-finalSun[i]])).map(row => row[0])
  if (![...nominal, ...matrix.flat(), ...finalRoot.flat()].every(Number.isFinite)) throw new RangeError('Propagated covariance exceeds the numerical range')
  const marginalSigmas = matrix.map((row, i) => Math.sqrt(row[i]))
  const refined = experiment.refinement
  const covarianceRefinement = refined ? (() => {
    // Push the same initial factor through the separately integrated refined
    // transition matrix. Do not substitute state agreement for covariance agreement.
    const transition = Array.from({ length: 6 }, (_, i) => refined.transitionMatrixValues.slice(i*6, i*6+6))
    const squareRoot = compensatedMatrixProduct(inverse, compensatedMatrixProduct(transition, initialRoot))
    const refinedMatrix = compensatedMatrixProduct(squareRoot, transpose(squareRoot))
    const refinedNominal = compensatedMatrixProduct(inverse, refined.finalStateKmKmPerSecond.map((value, i) => [value-finalSun[i]])).map(row => row[0])
    const refinedSigmas = refinedMatrix.map((row, i) => Math.sqrt(row[i]))
    const marginalSigmaAbsoluteDifference = refinedSigmas.map((value, i) => Math.abs(value-marginalSigmas[i]))
    if (![...squareRoot.flat(), ...refinedMatrix.flat(), ...refinedNominal, ...refinedSigmas, ...marginalSigmaAbsoluteDifference].every(Number.isFinite)) {
      throw new RangeError('Refined covariance exceeds the numerical range')
    }
    return { frame: source.frame, labels: initialCoordinates.labels, units: initialCoordinates.units, epoch: experiment.finalEpoch,
      orbitalPeriodUncertainty: orbitalPeriodUncertainty(refinedNominal, squareRoot, solarGmAu3PerDay2),
      nominal: refinedNominal, matrix: refinedMatrix, squareRoot, marginalSigmas: refinedSigmas, marginalSigmaAbsoluteDifference,
      limitation: 'Same source and force model with tighter integration settings; differences are not a global error bound, independent validation or physical uncertainty. Zero-duration agreement supplies no integration-convergence evidence.' }
  })() : null
  signal?.throwIfAborted()
  return { source, sourceFactorization: factorization, initialCoordinates: { ...initialCoordinates,
      squareRoot: initialCoordinateRoot,
      orbitalPeriodUncertainty: orbitalPeriodUncertainty(initialCoordinates.nominal, initialCoordinateRoot, solarGmAu3PerDay2) },
    coordinateTransform: {
      method: 'fixed-eclipj2000-j2000-prescribed-sun-v1',
      sourceFrame: source.frame, integrationFrame: 'J2000', integrationOrigin: 'SSB', timeScale: 'TDB',
      referenceEpochTdb: source.solutionEpochTdb, finalElapsedTdbSeconds: durationSeconds,
      auKm: AU, daySeconds: DAY, obliquityArcseconds: 84381.448, sunNaifId: 10,
      sunStateUnits: ['km','km','km','km/s','km/s','km/s'],
      initialSunStateKmKmPerSecond: Array.from(sun), finalSunStateKmKmPerSecond: Array.from(finalSun),
      ephemerisSource: frozenDynamics.evidence.ephemerisSource,
      limitation: 'Prescribed Sun states are deterministic translations; no solar ephemeris uncertainty is propagated.',
    }, experiment: { ...experiment,
    uncertainty: 'Conditional six-parameter first-order covariance is reported in finalCoordinates; the complete source-fit uncertainty and model error are not computed.' },
    finalCoordinates: { frame: source.frame, labels: initialCoordinates.labels, units: initialCoordinates.units,
      orbitalPeriodUncertainty: orbitalPeriodUncertainty(nominal, finalRoot, solarGmAu3PerDay2),
      epoch: experiment.finalEpoch, nominal, matrix, squareRoot: finalRoot, marginalSigmas }, covarianceRefinement,
    method: 'first-order-variational-square-root-pushforward', matrixArithmetic: COVARIANCE_MATRIX_ARITHMETIC,
    limitations: ['Conditional on the explicitly adopted restricted force model and fixed DE440 masses, trajectories and solar GM.',
      'Not propagation of the complete SBDB orbit-fit model; model mismatch and ephemeris/GM uncertainty are not included.',
      'Only six-parameter sources are currently supported. Additional fitted or considered force parameters require matched derivatives.',
      'First-order Gaussian covariance, not a nonlinear ensemble, event probability or physical-accuracy guarantee.',
      'The deterministic Sun translation contributes no additional covariance. Output uses heliocentric IAU76/80 J2000 ecliptic AU and AU/day.'] }
}
