const TWO_PI = Math.PI * 2
const RESIDUAL_TOLERANCE = 1e-13
const MAX_ITERATIONS = 48

export function solveEllipticKeplerRadians(meanAnomaly: number, eccentricity: number) {
  if (!Number.isFinite(meanAnomaly) || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError('Elliptic Kepler inputs require a finite mean anomaly and 0 <= e < 1')
  }
  const wrappedMeanAnomaly = meanAnomaly % TWO_PI
  const normalizedMeanAnomaly = wrappedMeanAnomaly < 0 ? wrappedMeanAnomaly + TWO_PI : wrappedMeanAnomaly
  const reflected = normalizedMeanAnomaly > Math.PI
  const reducedMeanAnomaly = reflected ? TWO_PI - normalizedMeanAnomaly : normalizedMeanAnomaly
  if (reducedMeanAnomaly === 0) return 0

  let lower = 0
  let upper = Math.PI
  let eccentricAnomaly = eccentricity < 0.8
    ? reducedMeanAnomaly
    : Math.min(Math.PI, reducedMeanAnomaly + 0.85 * eccentricity)

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - reducedMeanAnomaly
    if (Math.abs(residual) <= RESIDUAL_TOLERANCE) {
      return reflected ? TWO_PI - eccentricAnomaly : eccentricAnomaly
    }

    if (residual > 0) upper = eccentricAnomaly
    else lower = eccentricAnomaly

    const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly)
    const newton = eccentricAnomaly - residual / derivative
    eccentricAnomaly = Number.isFinite(newton) && newton > lower && newton < upper
      ? newton
      : (lower + upper) / 2
  }

  const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - reducedMeanAnomaly
  if (Math.abs(residual) > RESIDUAL_TOLERANCE) {
    throw new RangeError(
      `Elliptic Kepler iteration did not converge for M=${normalizedMeanAnomaly}, e=${eccentricity}`,
    )
  }
  return reflected ? TWO_PI - eccentricAnomaly : eccentricAnomaly
}
