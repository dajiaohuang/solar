/** Gaussian probability inside a three-dimensional Mahalanobis ball.
 * scipy.stats.chi2.cdf(radius**2, df=3); not one-dimensional sigma coverage. */
export const ELLIPSOID_LEVELS = Object.freeze([
  Object.freeze({ radius: 1, gaussianProbability3d: 0.19874804309879915 }),
  Object.freeze({ radius: 2, gaussianProbability3d: 0.7385358700508888 }),
  Object.freeze({ radius: 3, gaussianProbability3d: 0.9707091134651118 }),
])

/** A linear map of the unit sphere to the 3D position marginal ellipsoid.
 * Factor correlation first to preserve very different coordinate scales.
 * No jitter, negative-pivot clipping or visual axis exaggeration is applied. */
export function covarianceEllipsoid(matrix: number[][], scale = 1) {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Invalid ellipsoid unit scale')
  const sigma = Array.from({ length: 3 }, (_, i) => Math.sqrt(matrix[i]?.[i]))
  if (!sigma.every(Number.isFinite)) throw new RangeError('Invalid ellipsoid diagonal')
  const correlation = Array.from({ length: 3 }, () => [0, 0, 0])
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const value = matrix[i]?.[j]
    if (!Number.isFinite(value) || value !== matrix[j]?.[i]) throw new RangeError('Invalid symmetric position covariance')
    if (sigma[i] === 0 || sigma[j] === 0) {
      if (value !== 0) throw new RangeError('Nonzero covariance on zero variance')
    } else correlation[i][j] = i === j ? 1 : value/sigma[i]/sigma[j]
  }
  const lower = Array.from({ length: 3 }, () => [0, 0, 0])
  let rank = 0
  for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
    let value = correlation[i][j]
    for (let k = 0; k < j; k++) value -= lower[i][k]*lower[j][k]
    if (!Number.isFinite(value)) throw new RangeError('Nonfinite ellipsoid factorization')
    if (i === j) {
      if (value < 0) throw new RangeError('Position covariance is not numerically positive semidefinite')
      lower[i][j] = Math.sqrt(value)
      if (value > 0) rank++
    } else if (lower[j][j] > 0) lower[i][j] = value/lower[j][j]
    else if (value !== 0) throw new RangeError('Singular covariance cannot be factored without repair')
  }
  const displaySigmas = sigma.map(value => value*scale)
  if (displaySigmas.some((value, i) => !Number.isFinite(value) || (sigma[i] > 0 && value === 0))) throw new RangeError('Ellipsoid exceeds display unit range')
  const factor = lower.map((row, i) => row.map(value => value*displaySigmas[i]))
  const radiusBound = Math.hypot(...displaySigmas)
  if (!Number.isFinite(3*radiusBound) || !factor.flat().every(Number.isFinite) || factor.some((row, i) => row.some((value, j) => lower[i][j] !== 0 && value === 0))) throw new RangeError('Ellipsoid exceeds display unit range')
  return { factor, rank, radiusBound, scale,
    levels: ELLIPSOID_LEVELS.map(level => ({ ...level, gaussianProbability3d: rank === 3 ? level.gaussianProbability3d : null })),
    layout: 'row-major factor; position marginal = factor * transpose(factor); surface = radius * factor * unit sphere',
    limitation: 'Formal solution-epoch position marginal. No time propagation, event probability or complete physical-model uncertainty. Three-dimensional Gaussian coverage applies only to rank-three covariance.' }
}
