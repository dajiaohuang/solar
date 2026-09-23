/** Unit-Mahalanobis contour of a two-coordinate marginal covariance.
 * The caller supplies the conversion from its coordinate unit to the display
 * unit. This is a projected ellipse, not a three-dimensional confidence level. */
export function covarianceProjection(matrix: number[][], first: number, second: number, scale = 1) {
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first === second || !Number.isFinite(scale) || scale <= 0) throw new RangeError('Invalid covariance projection axes or scale')
  const a = matrix[first]?.[first], b = matrix[first]?.[second], c = matrix[second]?.[second]
  if (![a, b, c].every(Number.isFinite) || a < 0 || c < 0 || b !== matrix[second]?.[first]) throw new RangeError('Invalid symmetric covariance projection')
  const largest = Math.max(a, c), smallest = Math.min(a, c)
  const correlation = smallest > 0 ? b / Math.sqrt(a) / Math.sqrt(c) : b === 0 ? 0 : Infinity
  if (!Number.isFinite(correlation) || Math.abs(correlation) > 1) throw new RangeError('Covariance projection is not numerically positive semidefinite')
  // Never square a unit conversion or multiply raw variances: either can
  // overflow/underflow while both contour axes remain representable. Compute
  // the large eigenvalue in normalized units and the small one via correlation.
  const an = largest ? a / largest : 0, bn = largest ? b / largest : 0, cn = largest ? c / largest : 0
  const majorNormalized = (an + cn + Math.hypot(an - cn, 2 * bn)) / 2
  const major = Math.sqrt(largest) * Math.sqrt(majorNormalized) * scale
  const minor = majorNormalized ? Math.sqrt(smallest) * Math.sqrt((1 - correlation) * (1 + correlation) / majorNormalized) * scale : 0
  if (![major, minor].every(Number.isFinite)) throw new RangeError('Covariance contour exceeds display unit range')
  return { first, second, major, minor, angleRadians: Math.atan2(2 * bn, an - cn) / 2 }
}
