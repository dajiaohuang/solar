import { stateToConicDiagnostics } from './osculating.ts'

const AU = 149597870.7, DAY = 86400
export type OrbitalPeriodUncertaintyStatus = 'available' | 'invalid-or-unrepresentable-state' | 'near-parabolic' |
  'degenerate-orbit' | 'non-elliptic' | 'unrepresentable-period' | 'unrepresentable-projection'

/** Conditional delta-method projection through C = B B^T, retaining correlations.
 * Input state/root rows are heliocentric Cartesian AU and AU/day; GM is fixed. */
export function orbitalPeriodUncertainty(nominal: readonly number[], squareRoot: readonly (readonly number[])[], gmAu3PerDay2: number) {
  if (nominal.length !== 6 || Array.from(nominal).some(value => !Number.isFinite(value)) ||
      squareRoot.length !== 6 || Array.from(squareRoot).some(row => !row || row.length !== 6 || Array.from(row).some(value => !Number.isFinite(value))) ||
      !Number.isFinite(gmAu3PerDay2) || gmAu3PerDay2 <= 0) throw new RangeError('Invalid orbital-period covariance inputs')
  const radius = Math.hypot(...nominal.slice(0, 3))
  const diagnostic = stateToConicDiagnostics(
    { x: nominal[0]*AU, y: nominal[1]*AU, z: nominal[2]*AU },
    { x: nominal[3]*AU/DAY, y: nominal[4]*AU/DAY, z: nominal[5]*AU/DAY }, gmAu3PerDay2*AU**3/DAY**2)
  const alpha = diagnostic ? diagnostic.reciprocalSemiMajorAxisPerKm*AU : NaN
  // A rounded-away inverse axis outside the near-parabolic classification
  // must not become an apparent zero crossing with a separately valid sigma.
  const alphaRepresentable = Number.isFinite(alpha) && (alpha !== 0 || diagnostic?.nearParabolic === true)
  const period = diagnostic?.orbitalPeriodSeconds == null ? NaN : diagnostic.orbitalPeriodSeconds/DAY
  // alpha = 2/|r| - v.v/mu; dP = -(3/2)*(P/alpha)*dalpha.
  const alphaGradient = nominal.map((value, index) => index < 3
    ? (-2/radius)/radius*(value/radius) : -2*(value/gmAu3PerDay2))
  const alphaGradientRepresentable = alphaGradient.every((value, index) => Number.isFinite(value) &&
    (value !== 0 || nominal[index] === 0))
  const project = (gradient: readonly number[]) => {
    if (!gradient.every(Number.isFinite)) return null
    const projected: number[] = []
    for (let column = 0; column < 6; column++) {
      let sum = 0, correction = 0
      for (let row = 0; row < 6; row++) {
        const value = gradient[row]*squareRoot[row][column]
        // An unrepresentable contribution is not evidence of zero uncertainty.
        if (!Number.isFinite(value) || value === 0 && gradient[row] !== 0 && squareRoot[row][column] !== 0) return null
        const next = sum+value
        if (!Number.isFinite(next)) return null
        correction += Math.abs(sum) >= Math.abs(value) ? (sum-next)+value : (value-next)+sum
        sum = next
      }
      projected.push(sum+correction)
    }
    const sigma = Math.hypot(...projected)
    return Number.isFinite(sigma) ? sigma : null
  }
  const alphaSigma = alphaRepresentable && alphaGradientRepresentable ? project(alphaGradient) : null
  const periodGradient = Number.isFinite(period) && period > 0 && alphaRepresentable && alpha > 0
    ? alphaGradient.map(value => (-1.5*(period/alpha))*value) : null
  const finitePeriodGradient = alphaGradientRepresentable && periodGradient?.every((value, index) =>
    Number.isFinite(value) && (value !== 0 || alphaGradient[index] === 0)) ? periodGradient : null
  const periodSigma = finitePeriodGradient ? project(finitePeriodGradient) : null
  const periodStatus: OrbitalPeriodUncertaintyStatus = !diagnostic ? 'invalid-or-unrepresentable-state'
    : diagnostic.nearParabolic ? 'near-parabolic' : diagnostic.inclinationDeg === null ? 'degenerate-orbit'
    : diagnostic.eccentricity >= 1 || diagnostic.reciprocalSemiMajorAxisPerKm < 0 ? 'non-elliptic'
    : !Number.isFinite(period) || period <= 0 ? 'unrepresentable-period'
    : periodSigma === null ? 'unrepresentable-projection' : 'available'
  return {
    method: 'analytic-first-order-period-square-root-projection-v1',
    stateUnits: ['au', 'au', 'au', 'au/d', 'au/d', 'au/d'],
    stateLabels: ['x', 'y', 'z', 'vx', 'vy', 'vz'],
    covarianceFactorLayout: 'C = B B^T; rows follow stateLabels/stateUnits; project each column with the analytic gradient, then take the Euclidean norm.',
    fixedSolarGmAu3PerDay2: gmAu3PerDay2,
    periodStatus,
    nominalPeriodDays: Number.isFinite(period) && period > 0 ? period : null,
    periodSigmaDays: periodSigma,
    periodGradientDaysPerStateUnit: finitePeriodGradient,
    periodGradientUnits: ['d/au', 'd/au', 'd/au', 'd^2/au', 'd^2/au', 'd^2/au'],
    reciprocalSemiMajorAxisPerAu: alphaRepresentable ? alpha : null,
    reciprocalSemiMajorAxisGradient: alphaRepresentable && alphaGradientRepresentable ? alphaGradient : null,
    reciprocalSemiMajorAxisGradientUnits: ['au^-2', 'au^-2', 'au^-2', 'd/au^2', 'd/au^2', 'd/au^2'],
    reciprocalSemiMajorAxisSigmaPerAu: alphaSigma,
    linearOneSigmaAlphaIntervalReachesZero: alphaRepresentable && alphaSigma !== null ? alphaSigma >= Math.abs(alpha) : null,
    limitation: 'Conditional first-order formal uncertainty in the instantaneous Newtonian elliptic period, with fixed solar GM and ephemerides. Not uncertainty in an observed return time, a nonlinear period distribution or a confidence interval. Near the parabolic boundary the linear approximation can fail; null denotes undefined or unrepresentable results.',
  }
}
