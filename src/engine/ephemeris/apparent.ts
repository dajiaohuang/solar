import { SPEED_OF_LIGHT_KM_PER_SECOND } from './timeScales'

export type ApparentMode = 'geometric' | 'light-time' | 'light-time+stellar-aberration'
export interface BarycentricState { position: readonly [number, number, number]; velocity: readonly [number, number, number] }
export type StateAtJulianDay = (julianDay: number) => BarycentricState
export interface ApparentPositionOptions { target: StateAtJulianDay; observer: StateAtJulianDay; julianDay: number; mode?: ApparentMode; maxIterations?: number; toleranceSeconds?: number }
export interface ApparentPositionResult { position: [number, number, number]; mode: ApparentMode; lightTimeSeconds: number; emissionJulianDay: number; iterations: number; converged: boolean; assumptions: readonly string[] }

const DAY = 86_400
const norm = (v: readonly number[]) => Math.hypot(...v)
const valid = (s: BarycentricState) => { if (s.position.length !== 3 || s.velocity.length !== 3 || [...s.position, ...s.velocity].some(x => !Number.isFinite(x))) throw new RangeError('State vectors must contain finite 3-vectors') }
const subtract = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as [number, number, number]

function aberrate(n: [number, number, number], observerVelocity: readonly number[]) {
  const c = SPEED_OF_LIGHT_KM_PER_SECOND
  const beta = observerVelocity.map(v => v / c)
  const b2 = beta[0] ** 2 + beta[1] ** 2 + beta[2] ** 2
  if (b2 >= 1) throw new RangeError('Observer speed must be below the speed of light')
  if (b2 === 0) return n
  const gamma = 1 / Math.sqrt(1 - b2)
  const dot = n[0] * beta[0] + n[1] * beta[1] + n[2] * beta[2]
  // Lorentz transform of photon propagation k=-n into the observer frame, then reverse it.
  const factor = (gamma - 1) * (-dot) / b2 - gamma
  const denominator = gamma * (1 + dot)
  const k = [-n[0] + factor * beta[0], -n[1] + factor * beta[1], -n[2] + factor * beta[2]]
  return [-k[0] / denominator, -k[1] / denominator, -k[2] / denominator] as [number, number, number]
}

export function apparentPosition(options: ApparentPositionOptions): ApparentPositionResult {
  const { target, observer, julianDay, mode = 'geometric' } = options
  if (!Number.isFinite(julianDay)) throw new RangeError('Julian day must be finite')
  const maxIterations = options.maxIterations ?? 12
  const toleranceSeconds = options.toleranceSeconds ?? 1e-9
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 100 || !Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0) throw new RangeError('Invalid convergence settings')
  if (!['geometric', 'light-time', 'light-time+stellar-aberration'].includes(mode)) throw new RangeError('Unknown apparent-position mode')
  const observerState = observer(julianDay); valid(observerState)
  const geometricTarget = target(julianDay); valid(geometricTarget)
  let emissionJulianDay = julianDay
  let lightTimeSeconds = 0
  let iterations = 0
  let resolvedTarget = geometricTarget
  let converged = true
  if (mode !== 'geometric') {
    converged = false
    for (iterations = 1; iterations <= maxIterations; iterations += 1) {
      resolvedTarget = target(emissionJulianDay); valid(resolvedTarget)
      lightTimeSeconds = norm(subtract(resolvedTarget.position, observerState.position)) / SPEED_OF_LIGHT_KM_PER_SECOND
      const next = julianDay - lightTimeSeconds / DAY
      if (Math.abs(next - emissionJulianDay) * DAY <= toleranceSeconds) { emissionJulianDay = next; converged = true; break }
      emissionJulianDay = next
    }
    if (!converged) throw new RangeError('Light-time iteration did not converge')
    resolvedTarget = target(emissionJulianDay); valid(resolvedTarget)
  }
  let position = subtract(resolvedTarget.position, observerState.position)
  const distance = norm(position)
  if (mode === 'light-time+stellar-aberration' && distance > 0) position = aberrate(position.map(v => v / distance) as [number, number, number], observerState.velocity).map(v => v * distance) as [number, number, number]
  return { position, mode, lightTimeSeconds, emissionJulianDay, iterations, converged, assumptions: [
    mode === 'geometric' ? 'Geometric target and observer states are evaluated at the observation epoch.' : 'Reception light time solves target(emission) to observer(observation) iteratively.',
    ...(mode === 'light-time+stellar-aberration' ? ['Stellar aberration uses an exact special-relativistic photon-direction transform from observer barycentric velocity.'] : []),
    'No gravitational light deflection is applied; precomputed ephemeris force corrections must not be applied again.',
  ] }
}
