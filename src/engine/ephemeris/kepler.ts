const TWO_PI = Math.PI * 2
const MAX_ITERATIONS = 80

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
    : Math.min(Math.PI, Math.cbrt(6 * reducedMeanAnomaly / eccentricity))

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    // A fixed residual tolerance accepts a wrong root when e approaches one
    // and M approaches zero. Evaluate E - sin(E) without cancellation, and
    // stop on relative root accuracy instead.
    const squared = eccentricAnomaly * eccentricAnomaly
    const difference = eccentricAnomaly < 0.1
      ? eccentricAnomaly * squared * (1 / 6 - squared * (1 / 120 - squared * (1 / 5040 - squared * (1 / 362880 - squared / 39916800))))
      : eccentricAnomaly - Math.sin(eccentricAnomaly)
    const residual = (1 - eccentricity) * eccentricAnomaly + eccentricity * difference - reducedMeanAnomaly
    const derivative = (1 - eccentricity) + 2 * eccentricity * Math.sin(eccentricAnomaly / 2) ** 2
    const correction = residual / derivative
    if (Math.abs(correction) <= 4 * Number.EPSILON * Math.abs(eccentricAnomaly)) {
      return reflected ? TWO_PI - eccentricAnomaly : eccentricAnomaly
    }

    if (residual > 0) upper = eccentricAnomaly
    else lower = eccentricAnomaly

    const newton = eccentricAnomaly - correction
    const next = Number.isFinite(newton) && newton > lower && newton < upper
      ? newton
      : (lower + upper) / 2
    if (next === eccentricAnomaly) return reflected ? TWO_PI - next : next
    eccentricAnomaly = next
  }

  throw new RangeError(`Elliptic Kepler iteration did not converge for M=${normalizedMeanAnomaly}, e=${eccentricity}`)
}
