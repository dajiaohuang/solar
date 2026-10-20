import type { ApproximationSource } from './segmentedApproximation'

export type ForecastWindow = {
  model: 'two-body-universal'; startEt: number; endEt: number; seedEt: number
  seed: ApproximationSource; gmKm3S2: number; parameterSource: string
  sourceHashes: string[]; sourceUrls: string[]; anchorSource: 'source-fit' | 'horizons-vector'
  identityBoundary?: string; existenceBoundary?: string
  backtest: { samples: number; maximumPositionErrorKm: number | null; maximumVelocityErrorKmS: number | null; maximumOffsetDays: number }
  uncertainty: 'unknown-outside-source-coverage'
}
function stumpff(z: number) {
  if (Math.abs(z) < .1) {
    let c = .5, s = 1 / 6, ct = c, st = s
    for (let k = 1; k <= 16; k++) { ct *= -z / ((2 * k + 1) * (2 * k + 2)); st *= -z / ((2 * k + 2) * (2 * k + 3)); c += ct; s += st }
    return { c, s }
  }
  const x = Math.sqrt(Math.abs(z))
  return z > 0 ? { c: 2 * (Math.sin(x / 2) / x) ** 2, s: (x - Math.sin(x)) / x ** 3 }
    : { c: 2 * (Math.sinh(x / 2) / x) ** 2, s: (Math.sinh(x) - x) / x ** 3 }
}

/** Newtonian unperturbed conic in km/km/s, including hyperbolic states.
 * It does not model perturbations, maneuvers, collision or body existence. */
export function propagateTwoBody(seed: ApproximationSource, gmKm3S2: number, elapsedSeconds: number): ApproximationSource {
  const p = seed.position, v = seed.velocity, mu = gmKm3S2
  const axes = ['x', 'y', 'z'] as const
  if (![...Object.values(p), ...Object.values(v), mu, elapsedSeconds].every(Number.isFinite) || mu <= 0) throw new RangeError('Invalid forecast state or GM')
  const radius = Math.hypot(p.x, p.y, p.z), speed2 = v.x ** 2 + v.y ** 2 + v.z ** 2
  if (!(radius > 0)) throw new RangeError('Invalid forecast radius')
  const sqrtMu = Math.sqrt(mu), alpha = 2 / radius - speed2 / mu
  let time = elapsedSeconds
  if (alpha > 0) {
    const period = 2 * Math.PI / (sqrtMu * alpha ** 1.5)
    if (Number.isFinite(period)) time %= period
  }
  if (time === 0) return { position: { ...p }, velocity: { ...v } }
  const radial = (p.x * v.x + p.y * v.y + p.z * v.z) / sqrtMu, b = 1 - alpha * radius
  const equation = (chi: number) => {
    const { c, s } = stumpff(alpha * chi * chi)
    return { value: radial * chi ** 2 * c + b * chi ** 3 * s + radius * chi - sqrtMu * time,
      derivative: radial * chi * (1 - alpha * chi ** 2 * s) + b * chi ** 2 * c + radius, c, s }
  }
  let extent = Math.max(1, sqrtMu * Math.abs(time) * Math.max(Math.abs(alpha), 1 / radius)), low = 0, high = 0
  for (let i = 0; i < 128; i++) {
    if (time > 0) high = extent
    else low = -extent
    const value = equation(time > 0 ? high : low).value
    if (!Number.isFinite(value) || (time > 0 ? value >= 0 : value <= 0)) break
    if (i === 127) throw new RangeError('Forecast conic could not be bracketed')
    extent *= 2
  }
  let chi = (low + high) / 2, converged = false
  for (let i = 0; i < 160; i++) {
    const e = equation(chi)
    if (Number.isFinite(e.value) && Math.abs(e.value) <= 16 * Number.EPSILON * Math.max(1, sqrtMu * Math.abs(time))) { converged = true; break }
    if (e.value > 0) high = chi
    else if (e.value < 0) low = chi
    else if (!Number.isFinite(e.value)) { if (chi > 0) high = chi; else low = chi }
    const next = chi - e.value / e.derivative
    // Far hyperbolic brackets can have an exponential residual. A Newton
    // step near one endpoint then makes almost no progress; retain bisection.
    const margin = .05 * (high - low)
    const candidate = Number.isFinite(next) && next > low + margin && next < high - margin ? next : (low + high) / 2
    if (candidate === chi) { converged = true; break }
    chi = candidate
  }
  if (!converged) throw new RangeError('Forecast conic did not converge')
  const { c, s } = equation(chi), f = 1 - chi ** 2 * c / radius, g = time - chi ** 3 * s / sqrtMu
  const position = { x: f * p.x + g * v.x, y: f * p.y + g * v.y, z: f * p.z + g * v.z }
  const r = Math.hypot(position.x, position.y, position.z)
  const fdot = sqrtMu / (r * radius) * (alpha * chi ** 3 * s - chi), gdot = 1 - chi ** 2 * c / r
  const velocity = { x: fdot * p.x + gdot * v.x, y: fdot * p.y + gdot * v.y, z: fdot * p.z + gdot * v.z }
  if (!axes.every(axis => Number.isFinite(position[axis]) && Number.isFinite(velocity[axis])) || !(r > 0)) throw new RangeError('Forecast state exceeds numerical range')
  return { position, velocity }
}
