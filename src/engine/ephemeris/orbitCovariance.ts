import type { SbdbCovariance } from '../../data/loaders/sbdbCovariance'
import { solveEllipticKeplerRadians } from './kepler.ts'

export type AdoptedSolarGM = { au3PerDay2: number; source: string }
const orbitalLabels = ['e', 'q', 'tp', 'node', 'peri', 'i']
const orbitalUnits = [null, 'au', 'd', 'deg', 'deg', 'deg']
const DEG = Math.PI / 180

/** Coordinate conversion at the solution epoch only. The adopted central GM
 * is explicit: SBDB does not supply it with cov=mat. This is not an integration
 * of the source orbit-determination force model or a future event prediction. */
export function cartesianCovarianceAtSolutionEpoch(source: SbdbCovariance, gm: AdoptedSolarGM) {
  if (!Number.isFinite(gm.au3PerDay2) || gm.au3PerDay2 <= 0 || !gm.source?.trim()) throw new RangeError('An explicit positive solar GM and its source are required')
  const n = source.labels.length, axes = orbitalLabels.map(label => source.labels.indexOf(label))
  if (n < 6 || n > 16 || new Set(source.labels).size !== n || axes.some((axis, i) => axis < 0 || axis >= 6 || source.units[axis] !== orbitalUnits[i]) ||
      source.nominal.length !== n || source.nominal.some(value => !Number.isFinite(value)) ||
      source.frame !== 'heliocentric-IAU76/80-ecliptic-J2000' || !Number.isFinite(source.solutionEpochTdb) ||
      source.matrix.length !== n || source.matrix.some(row => row.length !== n || row.some(value => !Number.isFinite(value)))) {
    throw new RangeError('Invalid audited SBDB covariance contract')
  }
  const [e, q, tp, node, peri, inclination] = axes.map(axis => source.nominal[axis])
  // Near-parabolic/non-elliptic conversion needs a different nonsingular
  // formulation. Reject it explicitly instead of substituting an ellipse.
  if (e < 0 || e > .9999 || q <= 0 || inclination < 0 || inclination > 180) throw new RangeError('Cartesian covariance currently requires 0 <= e <= 0.9999, q > 0 and 0 <= i <= 180')
  const a = q / (1 - e), motion = Math.sqrt(gm.au3PerDay2 / a ** 3)
  const elapsed = source.solutionEpochTdb - tp, mean = motion * elapsed
  if (!Number.isFinite(a) || !(motion > 0) || !Number.isFinite(mean) || Math.abs(mean) > 1e6) throw new RangeError('Orbital scale or accumulated phase exceeds the conversion domain')
  const eccentric = solveEllipticKeplerRadians(mean, e), sinE = Math.sin(eccentric), cosE = Math.cos(eccentric)
  const beta = Math.sqrt((1 - e) * (1 + e)), denominator = (1 - e) + 2 * e * Math.sin(eccentric / 2) ** 2
  const x = a * ((1 - e) - 2 * Math.sin(eccentric / 2) ** 2), y = a * beta * sinE
  const speed = motion * a / denominator, vx = -speed * sinE, vy = speed * beta * cosE
  const O = node * DEG, w = peri * DEG, i = inclination * DEG
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i)
  const p = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si]
  const r = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si]
  const dNodeP = [-p[1], p[0], 0], dNodeR = [-r[1], r[0], 0]
  const dInclinationP = [sO * sw * si, -cO * sw * si, sw * ci]
  const dInclinationR = [sO * cw * si, -cO * cw * si, cw * ci]
  const nominal = [...p.map((v, k) => x * v + y * r[k]), ...p.map((v, k) => vx * v + vy * r[k]), ...source.nominal.slice(6)]
  const jacobian = Array.from({ length: n }, () => Array<number>(n).fill(0))
  for (let axis = 0; axis < 6; axis++) {
    const de = axis === 0 ? 1 : 0
    const da = axis === 0 ? a / (1 - e) : axis === 1 ? 1 / (1 - e) : 0
    const dn = -1.5 * motion * da / a
    // Differentiate the unwrapped phase; dropping complete revolutions would
    // lose semimajor-axis/phase sensitivity. Only the scalar root is wrapped.
    const dMean = dn * elapsed - (axis === 2 ? motion : 0)
    const dE = (dMean + sinE * de) / denominator, dBeta = -e * de / beta
    const dx = da * ((1 - e) - 2 * Math.sin(eccentric / 2) ** 2) - a * (sinE * dE + de)
    const dy = da * beta * sinE + a * dBeta * sinE + a * beta * cosE * dE
    const dd = -cosE * de + e * sinE * dE
    const dSpeed = (dn * a + motion * da) / denominator - speed * dd / denominator
    const dvx = -dSpeed * sinE - speed * cosE * dE
    const dvy = dSpeed * beta * cosE + speed * dBeta * cosE - speed * beta * sinE * dE
    for (let k = 0; k < 3; k++) {
      const dp = axis === 3 ? dNodeP[k] * DEG : axis === 4 ? r[k] * DEG : axis === 5 ? dInclinationP[k] * DEG : 0
      const dr = axis === 3 ? dNodeR[k] * DEG : axis === 4 ? -p[k] * DEG : axis === 5 ? dInclinationR[k] * DEG : 0
      jacobian[k][axes[axis]] = dx * p[k] + dy * r[k] + x * dp + y * dr
      jacobian[k + 3][axes[axis]] = dvx * p[k] + dvy * r[k] + vx * dp + vy * dr
    }
  }
  // Estimated/considered dynamical parameters remain in the joint vector.
  // At this epoch the coordinate map has an identity block for those axes;
  // their state cross-correlations are transformed, never discarded.
  for (let axis = 6; axis < n; axis++) jacobian[axis][axis] = 1
  const symmetric = source.matrix.map((row, k) => row.map((value, j) => (value + source.matrix[j][k]) / 2))
  const left = jacobian.map(row => row.map((_, j) => row.reduce((sum, value, k) => sum + value * symmetric[k][j], 0)))
  const matrix = Array.from({ length: n }, () => Array<number>(n).fill(0))
  for (let row = 0; row < n; row++) for (let column = row; column < n; column++) {
    const value = left[row].reduce((sum, entry, k) => sum + entry * jacobian[column][k], 0)
    matrix[row][column] = matrix[column][row] = value
  }
  if ([...nominal, ...jacobian.flat(), ...matrix.flat()].some(value => !Number.isFinite(value)) || matrix.some((row, i) => row[i] < 0)) {
    throw new RangeError('Cartesian covariance conversion lost numerical validity')
  }
  return {
    model: 'elliptic-osculating-coordinate-transform' as const,
    epochTdb: source.solutionEpochTdb, frame: source.frame,
    labels: ['x', 'y', 'z', 'vx', 'vy', 'vz', ...source.labels.slice(6)],
    units: ['au', 'au', 'au', 'au/d', 'au/d', 'au/d', ...source.units.slice(6)],
    nominal, matrix, jacobian, marginalSigmas: matrix.map((row, i) => Math.sqrt(row[i])),
    inputLabels: source.labels.slice(), inputUnits: source.units.slice(),
    adoptedSolarGM: { ...gm },
    source: { designation: source.designation, spkId: source.spkId, solutionId: source.solutionId,
      solutionEpochTdb: source.solutionEpochTdb, standardElementEpochTdb: source.standardElementEpochTdb,
      planetaryEphemeris: source.planetaryEphemeris, smallBodyEphemeris: source.smallBodyEphemeris },
    limitations: ['First-order coordinate transformation at the covariance solution epoch, not temporal propagation.',
      'Conditional on the explicit adopted solar GM; SBDB cov=mat does not supply a GM or its uncertainty.',
      'Additional dynamical parameters and cross-correlations are retained but no force model is integrated.',
      'Formal fit covariance does not include every physical model error or establish an event probability.'],
  }
}
