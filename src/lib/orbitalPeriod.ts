import type { OrbitDefinition } from '../types'

const DEGREES_PER_REVOLUTION = 360
const SOLAR_ORBIT_PERIOD_AT_ONE_AU_DAYS = 365.2568983

export type OrbitCenter = 'sun' | 'parent'

/**
 * Returns the period used by the declared educational propagation model.
 *
 * Keplerian elements carry their central-body dynamics in the stored mean
 * motion, matching the propagator. Planetary approximations use the solar
 * two-body period implied by their semi-major axis. This distinction does not
 * add perturbations or improve the accuracy of the underlying elements.
 */
export function getOrbitalPeriodDays(
  orbit: OrbitDefinition,
  center: OrbitCenter,
  heliocentricSemiMajorAxisAU?: number,
) {
  if (orbit.model === 'keplerian') {
    if (!Number.isFinite(orbit.meanMotionDegPerDay) || orbit.meanMotionDegPerDay <= 0) {
      throw new RangeError('Mean motion must be a positive finite value')
    }

    return DEGREES_PER_REVOLUTION / orbit.meanMotionDegPerDay
  }

  if (center === 'parent') {
    throw new RangeError('Parent-centered periods require Keplerian mean motion')
  }

  const semiMajorAxisAU = heliocentricSemiMajorAxisAU
    ?? orbit.base.semiMajorAxisAU
  if (!Number.isFinite(semiMajorAxisAU) || semiMajorAxisAU <= 0) {
    throw new RangeError('Semi-major axis must be a positive finite value')
  }

  return SOLAR_ORBIT_PERIOD_AT_ONE_AU_DAYS * Math.sqrt(semiMajorAxisAU ** 3)
}
