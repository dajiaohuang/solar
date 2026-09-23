import type { Derivative } from './adaptiveIntegrator'

export type PointMass = {
  naifId: number
  gmKm3PerSecond2: number
  gmSource: string
  /** Explicit close-approach exclusion, not necessarily a physical radius. */
  exclusionKm: number
}
export type PrescribedEphemeris = {
  frame: 'J2000'
  origin: 'SSB'
  timeScale: 'TDB'
  aberration: 'NONE'
  referenceEpochTdb: number
  elapsedRangeSeconds: readonly [number, number]
  source: string
  /** Fill xyz km triples in the supplied point-mass order, or throw for gaps. */
  positions(elapsedSeconds: number, naifIds: readonly number[], outputKm: Float64Array): void
}

/** Restricted Newtonian dynamics: prescribed masses do not react to the test
 * particle. Barycentric inertial coordinates avoid silently omitting a moving
 * heliocentric origin's indirect acceleration. No relativity, harmonics or
 * non-gravitational force is implicitly included. */
export function createPointMassGravity(inputMasses: readonly PointMass[], ephemeris: PrescribedEphemeris) {
  const masses = Object.freeze(inputMasses.map(mass => Object.freeze({ ...mass }))), ids = Object.freeze(masses.map(mass => mass.naifId))
  const [start, end] = ephemeris.elapsedRangeSeconds
  if (!masses.length || masses.length > 32 || new Set(ids).size !== ids.length ||
      masses.some(mass => !Number.isSafeInteger(mass.naifId) || !Number.isFinite(mass.gmKm3PerSecond2) || mass.gmKm3PerSecond2 <= 0 || !mass.gmSource.trim() || !Number.isFinite(mass.exclusionKm) || mass.exclusionKm < 0) ||
      ![start, end, ephemeris.referenceEpochTdb].every(Number.isFinite) || start > end || !ephemeris.source.trim() ||
      ephemeris.frame !== 'J2000' || ephemeris.origin !== 'SSB' || ephemeris.timeScale !== 'TDB' || ephemeris.aberration !== 'NONE') throw new RangeError('Invalid inertial point-mass model contract')
  const positions = new Float64Array(3 * masses.length), gradient = new Float64Array(9)
  // Bind metadata and evaluator once; caller changes cannot silently switch a run.
  const positionsAt = ephemeris.positions.bind(ephemeris)
  const derivative: Derivative = (elapsed, state, output) => {
    if (!Number.isFinite(elapsed) || elapsed < start || elapsed > end) throw new RangeError('Force epoch outside prescribed ephemeris coverage')
    if (![6, 42].includes(state.length) || output.length !== state.length || !state.every(Number.isFinite)) throw new RangeError('Expected six-state or six-state plus row-major 6x6 transition matrix')
    positions.fill(NaN); positionsAt(elapsed, ids, positions)
    if (!positions.every(Number.isFinite)) throw new RangeError('Prescribed source did not supply every finite mass position')
    const variational = state.length === 42
    output.fill(0)
    if (variational) gradient.fill(0)
    output.set(state.subarray(3, 6))
    for (let index = 0; index < masses.length; index++) {
      const mass = masses[index]
      const d = [positions[3*index] - state[0], positions[3*index+1] - state[1], positions[3*index+2] - state[2]]
      const distance = Math.hypot(...d)
      if (!Number.isFinite(distance) || distance <= mass.exclusionKm || distance === 0) throw new RangeError(`Point-mass exclusion reached for NAIF ${mass.naifId}`)
      const unit = d.map(value => value / distance)
      const acceleration = mass.gmKm3PerSecond2 / distance / distance, curvature = acceleration / distance
      for (let row = 0; row < 3; row++) {
        output[row+3] += acceleration * unit[row]
        if (variational) for (let column = 0; column < 3; column++) gradient[3*row+column] += curvature * (3*unit[row]*unit[column] - Number(row === column))
      }
    }
    if (variational) {
      // dPhi/dt = [0 I; da/dr 0] Phi. This transition matrix conditions on
      // fixed force parameters and prescribed ephemerides; it is not a full
      // joint SBDB state/parameter covariance propagation.
      for (let row = 0; row < 3; row++) for (let column = 0; column < 6; column++) {
        output[6 + row*6 + column] = state[6 + (row+3)*6 + column]
        for (let k = 0; k < 3; k++) output[6 + (row+3)*6 + column] += gradient[3*row+k] * state[6 + k*6 + column]
      }
    }
    if (!output.every(Number.isFinite)) throw new RangeError('Point-mass force or variational derivative became nonfinite')
  }
  return { derivative, evidence: {
    model: 'restricted-newtonian-prescribed-point-masses' as const,
    masses, frame: ephemeris.frame, origin: ephemeris.origin, timeScale: ephemeris.timeScale,
    aberration: ephemeris.aberration, referenceEpochTdb: ephemeris.referenceEpochTdb,
    elapsedRangeSeconds: [start, end], ephemerisSource: ephemeris.source,
    stateUnits: ['km', 'km', 'km', 'km/s', 'km/s', 'km/s'],
    limitations: ['Force parameters and prescribed mass trajectories are fixed.',
      'No relativistic, harmonic, non-gravitational or test-particle back-reaction forces.',
      'No physical uncertainty, event probability or full orbit-fit model equivalence is established.',
      'Exclusion distances are checked at force evaluations; continuous collision detection is not implemented.',
      'Caller must avoid overlapping system-barycenter and constituent mass representations.'],
  } }
}

export function withIdentityTransition(initial: ArrayLike<number>) {
  if (initial.length !== 6 || !Array.from(initial).every(Number.isFinite)) throw new RangeError('Expected finite six-component initial state')
  const state = new Float64Array(42)
  state.set(initial)
  for (let i = 0; i < 6; i++) state[6 + i*6+i] = 1
  return state
}
