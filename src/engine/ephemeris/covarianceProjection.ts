/** Unit-Mahalanobis contour of a two-coordinate marginal covariance.
 * The caller supplies the conversion from its coordinate unit to the display
 * unit. This is a projected ellipse, not a three-dimensional confidence level. */
export function covarianceProjection(matrix: number[][], first: number, second: number, scale = 1) {
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first === second || !Number.isFinite(scale) || scale <= 0) throw new RangeError('Invalid covariance projection axes or scale')
  const a = matrix[first]?.[first] * scale ** 2, b = matrix[first]?.[second] * scale ** 2, c = matrix[second]?.[second] * scale ** 2
  if (![a, b, c].every(Number.isFinite) || a < 0 || c < 0) throw new RangeError('Invalid covariance projection')
  const majorVariance = (a + c + Math.hypot(a - c, 2 * b)) / 2
  const determinant = a * c - b * b
  if (!Number.isFinite(majorVariance) || !Number.isFinite(determinant) || determinant < 0) throw new RangeError('Covariance projection is not numerically positive semidefinite')
  const minorVariance = majorVariance ? determinant / majorVariance : 0
  return { first, second, major: Math.sqrt(majorVariance), minor: Math.sqrt(minorVariance), angleRadians: Math.atan2(2 * b, a - c) / 2 }
}
