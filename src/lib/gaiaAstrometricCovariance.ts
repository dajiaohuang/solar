import type { GaiaSource } from './gaiaChunks'

const baseFields = ['ra', 'dec', 'parallax', 'pmra', 'pmdec'] as const

/** Formal five-coordinate marginal or full six-parameter source solution. No zero-point,
 * systematic, pseudocolour conditioning or epoch propagation is applied. */
export function gaiaAstrometricCovariance(source: GaiaSource, dimension: 5 | 6 = 5) {
  const fields = dimension === 6 ? [...baseFields, 'pseudocolour'] : baseFields
  const unavailable = (reason: string) => ({ available: false as const, reason })
  if (dimension !== 5 && dimension !== 6) return unavailable('unsupported-covariance-dimension')
  if (dimension === 6 && source.astrometric_params_solved !== 95) return unavailable('six-parameter-solution-unavailable')
  if (source.ref_epoch !== 2016) return unavailable('unsupported-astrometric-epoch')
  if (source.astrometric_params_solved !== 31 && source.astrometric_params_solved !== 95) return unavailable('five-parameter-solution-unavailable')
  const sigmas: number[] = []
  for (const field of fields) {
    const sigma = source[`${field}_error`]
    if (typeof sigma !== 'number' || !Number.isFinite(sigma) || sigma <= 0) return unavailable('missing-or-nonpositive-formal-error')
    sigmas.push(sigma)
  }
  const correlation: number[][] = Array.from({ length: dimension }, (_, i) => Array.from({ length: dimension }, (_, j) => i === j ? 1 : 0))
  for (let i = 0; i < dimension; i++) for (let j = i + 1; j < dimension; j++) {
    const value = source[`${fields[i]}_${fields[j]}_corr`]
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1) return unavailable('missing-or-invalid-correlation')
    correlation[i][j] = correlation[j][i] = value
  }
  // Pairwise [-1,1] checks alone do not establish a valid joint matrix.
  // Require a positive factorization without clipping, jitter or repair.
  const lower = Array.from({ length: dimension }, () => Array<number>(dimension).fill(0))
  for (let i = 0; i < dimension; i++) for (let j = 0; j <= i; j++) {
    let value = correlation[i][j]
    for (let k = 0; k < j; k++) value -= lower[i][k]*lower[j][k]
    if (i === j) {
      if (!(value > 0)) return unavailable('joint-matrix-not-numerically-positive-definite')
      lower[i][j] = Math.sqrt(value)
    } else lower[i][j] = value/lower[j][j]
  }
  const matrix = Array.from({ length: dimension }, () => Array<number>(dimension).fill(0))
  for (let i = 0; i < dimension; i++) for (let j = i; j < dimension; j++) matrix[i][j] = matrix[j][i] = correlation[i][j]*sigmas[i]*sigmas[j]
  if (matrix.some((row, i) => !(row[i] > 0) || row.some(value => !Number.isFinite(value)))) return unavailable('unrepresentable-covariance')
  return { available: true as const, matrix, correlation, epochJulianYear: 2016, timeScale: 'TCB', frame: 'ICRS',
    coordinateLabels: ['delta-alpha*cos(delta)', 'delta-dec', 'parallax', 'pmra', 'pmdec', ...(dimension === 6 ? ['pseudocolour'] : [])],
    coordinateUnits: ['mas', 'mas', 'mas', 'mas/Julian-year', 'mas/Julian-year', ...(dimension === 6 ? ['inverse-micrometre'] : [])],
    matrixUnits: 'product-of-row-and-column-coordinate-units',
    sourceSolutionParameters: source.astrometric_params_solved === 95 ? 6 : 5,
    scope: dimension === 6 ? 'six-parameter-astrometric-pseudocolour-solution' : 'five-astrometric-parameter-marginal', pseudocolourIncluded: dimension === 6,
    validation: 'strict-positive-correlation-Cholesky-no-repair', includesSystematics: false, propagated: false }
}
