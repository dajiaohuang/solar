import { parseSbdbCovariance } from '../data/loaders/sbdbCovariance.ts'
import { cartesianCovarianceAtSolutionEpoch } from '../engine/ephemeris/orbitCovariance.ts'
import { factorSbdbCovariance } from '../engine/ephemeris/covarianceSampling.ts'
import { orbitalPeriodUncertainty } from '../engine/ephemeris/orbitalPeriodUncertainty.ts'
import { compensatedMatrixProduct, COVARIANCE_MATRIX_ARITHMETIC } from '../engine/numerics/compensatedMatrixProduct.ts'

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid covariance pushforward record')
  return value as Record<string, unknown>
}
const same = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Covariance pushforward differs from its source or transition')
}
const transition = (value: unknown) => {
  if (!Array.isArray(value) || value.length !== 36) throw new Error('Expected 36 transition entries')
  const entries = Array.from(value, item => {
    if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error('Nonfinite covariance transition entry')
    return item
  })
  return Array.from({ length: 6 }, (_, i) => entries.slice(i*6,i*6+6))
}
const state = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length !== 6) throw new Error('Expected six coordinate state entries')
  return Array.from(value, item => {
    if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error('Nonfinite coordinate state entry')
    return item
  })
}

/** Same-runtime algebraic binding only; the returned transition is not reintegrated. */
export function checkCovariancePushforward(payload: unknown, receipt: Record<string, unknown>) {
  const source = parseSbdbCovariance(payload)
  if (source.labels.length !== 6) throw new Error('Six covariance source axes required')
  if (receipt.matrixArithmetic !== COVARIANCE_MATRIX_ARITHMETIC) throw new Error('Covariance matrix arithmetic version mismatch')
  const experiment = record(receipt.experiment), force = record(experiment.forceModel)
  if (!Array.isArray(force.masses)) throw new Error('Covariance force masses missing')
  const solar = force.masses.map(record).find(mass => mass.naifId === 10)
  if (!solar || typeof solar.gmKm3PerSecond2 !== 'number' || !Number.isFinite(solar.gmKm3PerSecond2) || solar.gmKm3PerSecond2 <= 0 || typeof solar.gmSource !== 'string') throw new Error('Covariance solar GM missing')
  const AU = 149597870.7, DAY = 86400, angle = 84381.448/3600*Math.PI/180
  const c = Math.cos(angle), s = Math.sin(angle), rotation = [[1,0,0],[0,c,-s],[0,s,c]]
  const initial = cartesianCovarianceAtSolutionEpoch(source, { au3PerDay2: solar.gmKm3PerSecond2*DAY**2/AU**3, source: solar.gmSource })
  const claimed = record(receipt.initialCoordinates)
  for (const key of ['adoptedSolarGM','nominal','jacobian','matrix','matrixArithmetic','marginalSigmas'] as const) same(claimed[key],initial[key])
  const { lower, sigmas, factorization } = factorSbdbCovariance(source)
  same(receipt.sourceFactorization,factorization)
  const sourceRoot = lower.map((row, i) => row.map(value => value*sigmas[i]))
  const transform = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.floor(i/3) === Math.floor(j/3) ? rotation[i%3][j%3]*AU/(i < 3 ? 1 : DAY) : 0))
  const inverse = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.floor(i/3) === Math.floor(j/3) ? rotation[j%3][i%3]*(i < 3 ? 1 : DAY)/AU : 0))
  const initialCoordinateRoot = compensatedMatrixProduct(initial.jacobian,sourceRoot)
  same(claimed.squareRoot,initialCoordinateRoot)
  same(claimed.orbitalPeriodUncertainty,orbitalPeriodUncertainty(initial.nominal,initialCoordinateRoot,solar.gmKm3PerSecond2*DAY**2/AU**3))
  const initialRoot = compensatedMatrixProduct(transform,initialCoordinateRoot)
  const frame = record(receipt.coordinateTransform), epoch = record(experiment.finalEpoch)
  const expectedFrame = {
    method: 'fixed-eclipj2000-j2000-prescribed-sun-v1', sourceFrame: source.frame,
    integrationFrame: 'J2000', integrationOrigin: 'SSB', timeScale: 'TDB',
    referenceEpochTdb: source.solutionEpochTdb, finalElapsedTdbSeconds: epoch.elapsedTdbSeconds,
    auKm: AU, daySeconds: DAY, obliquityArcseconds: 84381.448, sunNaifId: 10,
    sunStateUnits: ['km','km','km','km/s','km/s','km/s'], ephemerisSource: force.ephemerisSource,
  }
  for (const [key, expected] of Object.entries(expectedFrame)) same(frame[key],expected)
  if (typeof frame.limitation !== 'string' || !frame.limitation.trim()) throw new Error('Coordinate transformation limitation missing')
  const initialSun = state(frame.initialSunStateKmKmPerSecond), finalSun = state(frame.finalSunStateKmKmPerSecond)
  const initialState = compensatedMatrixProduct(transform,initial.nominal.map(value => [value])).map((row,i) => row[0]+initialSun[i])
  const samples = record(experiment.trajectory).samples
  if (!Array.isArray(samples) || samples.length < 1) throw new Error('Initial integration sample missing')
  const first = record(samples[0])
  same(first.elapsedTdbSeconds,0); same(state(first.stateKmKmPerSecond),initialState)
  if (epoch.elapsedTdbSeconds === 0) {
    same(finalSun,initialSun)
    same(state(experiment.finalStateKmKmPerSecond),initialState)
  }
  const checkNominal = (raw: unknown, coordinates: unknown) => {
    const endpoint = state(raw)
    const expected = compensatedMatrixProduct(inverse,endpoint.map((value,i) => [value-finalSun[i]])).map(row => row[0])
    if (!expected.every(Number.isFinite)) throw new Error('Coordinate endpoint exceeds numeric range')
    same(state(record(coordinates).nominal),expected)
  }
  checkNominal(experiment.finalStateKmKmPerSecond,receipt.finalCoordinates)
  const check = (values: unknown, coordinates: unknown) => {
    const expected = compensatedMatrixProduct(inverse,compensatedMatrixProduct(transition(values),initialRoot))
    if (!expected.flat().every(Number.isFinite)) throw new Error('Covariance pushforward exceeds numeric range')
    same(record(coordinates).squareRoot,expected)
    same(record(coordinates).orbitalPeriodUncertainty, orbitalPeriodUncertainty(
      state(record(coordinates).nominal), expected, (solar.gmKm3PerSecond2 as number)*DAY**2/AU**3))
  }
  const primary = record(experiment.transitionMatrix)
  same(primary.dimension,6)
  same(primary.layout,'row-major; d(final J2000 SSB state)/d(initial J2000 SSB state)')
  check(primary.values,receipt.finalCoordinates)
  if (receipt.covarianceRefinement !== null) {
    const refined = record(experiment.refinement)
    check(refined.transitionMatrixValues,receipt.covarianceRefinement)
    checkNominal(refined.finalStateKmKmPerSecond,receipt.covarianceRefinement)
  }
}
