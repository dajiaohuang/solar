const TWO_PI = Math.PI * 2
const MAX_ITERATIONS = 80

/** Returns the signed principal root (adding a turn erases tiny negative roots
 * near periapsis); optional scratch receives sin(E/2) and sin(E) in that order. */
export function solveEllipticKeplerRadians(meanAnomaly: number, eccentricity: number, trigonometry?: Float64Array) {
  if (!Number.isFinite(meanAnomaly) || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError('Elliptic Kepler inputs require a finite mean anomaly and 0 <= e < 1')
  }
  if (trigonometry && trigonometry.length !== 2) throw new RangeError('Kepler trigonometry output must have two values')
  const wrappedMeanAnomaly = meanAnomaly % TWO_PI
  const normalizedMeanAnomaly = wrappedMeanAnomaly > Math.PI ? wrappedMeanAnomaly - TWO_PI
    : wrappedMeanAnomaly < -Math.PI ? wrappedMeanAnomaly + TWO_PI : wrappedMeanAnomaly
  const reflected = normalizedMeanAnomaly < 0
  const reducedMeanAnomaly = Math.abs(normalizedMeanAnomaly)
  if (reducedMeanAnomaly === 0) {
    if (trigonometry) trigonometry.fill(0)
    return 0
  }

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
    let sineAnomaly: number | undefined
    const difference = eccentricAnomaly < 0.1
      ? eccentricAnomaly * squared * (1 / 6 - squared * (1 / 120 - squared * (1 / 5040 - squared * (1 / 362880 - squared / 39916800))))
      : eccentricAnomaly - (sineAnomaly = Math.sin(eccentricAnomaly))
    const sineHalfAnomaly = Math.sin(eccentricAnomaly / 2)
    const residual = (1 - eccentricity) * eccentricAnomaly + eccentricity * difference - reducedMeanAnomaly
    const derivative = (1 - eccentricity) + 2 * eccentricity * sineHalfAnomaly ** 2
    const correction = residual / derivative
    if (Math.abs(correction) <= 4 * Number.EPSILON * Math.abs(eccentricAnomaly)) {
      return finishKeplerRoot(eccentricAnomaly, reflected, sineHalfAnomaly, sineAnomaly, trigonometry)
    }

    if (residual > 0) upper = eccentricAnomaly
    else lower = eccentricAnomaly

    const newton = eccentricAnomaly - correction
    const next = Number.isFinite(newton) && newton > lower && newton < upper
      ? newton
      : (lower + upper) / 2
    if (next === eccentricAnomaly) return finishKeplerRoot(next, reflected, sineHalfAnomaly, sineAnomaly, trigonometry)
    eccentricAnomaly = next
  }

  throw new RangeError(`Elliptic Kepler iteration did not converge for M=${normalizedMeanAnomaly}, e=${eccentricity}`)
}

function finishKeplerRoot(eccentricAnomaly: number, reflected: boolean, sineHalfAnomaly: number,
  sineAnomaly: number | undefined, trigonometry?: Float64Array) {
  const result = reflected ? -eccentricAnomaly : eccentricAnomaly
  if (trigonometry) {
    if (reflected) {
      // Match the historical signed Math.sin arguments exactly on the reflected branch.
      trigonometry[0] = Math.sin(result / 2)
      trigonometry[1] = Math.sin(result)
    } else {
      trigonometry[0] = sineHalfAnomaly
      trigonometry[1] = sineAnomaly ?? Math.sin(eccentricAnomaly)
    }
  }
  return result
}
