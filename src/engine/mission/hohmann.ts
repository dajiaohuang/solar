import { SOLAR_GM_AU3_PER_DAY2, auPerDayToKmPerSecond } from '../units'

export type HohmannDirection = 'outward' | 'inward'

export type HohmannResult = {
  model: 'circular-two-body'
  centralBody: 'Sun'
  direction: HohmannDirection
  semiMajorAxisAU: number
  eccentricity: number
  departureDeltaVKmS: number
  arrivalDeltaVKmS: number
  totalDeltaVKmS: number
  transferTimeDays: number
  assumptions: string[]
}
/**
 * Circular, coplanar, impulsive Hohmann transfer around the Sun.
 * Signed burns are positive for prograde acceleration and negative for braking.
 */
export function computeHohmann(
  departureRadiusAU: number,
  arrivalRadiusAU: number,
): HohmannResult | null {
  if (
    !Number.isFinite(departureRadiusAU) ||
    !Number.isFinite(arrivalRadiusAU) ||
    departureRadiusAU <= 0 ||
    arrivalRadiusAU <= 0 ||
    departureRadiusAU === arrivalRadiusAU
  ) {
    return null
  }

  const direction: HohmannDirection = arrivalRadiusAU > departureRadiusAU ? 'outward' : 'inward'
  const transferSemiMajor = (departureRadiusAU + arrivalRadiusAU) / 2
  const periapsis = Math.min(departureRadiusAU, arrivalRadiusAU)
  const apoapsis = Math.max(departureRadiusAU, arrivalRadiusAU)
  const eccentricity = (apoapsis - periapsis) / (apoapsis + periapsis)

  const circularDeparture = Math.sqrt(SOLAR_GM_AU3_PER_DAY2 / departureRadiusAU)
  const circularArrival = Math.sqrt(SOLAR_GM_AU3_PER_DAY2 / arrivalRadiusAU)
  const transferDeparture = Math.sqrt(
    SOLAR_GM_AU3_PER_DAY2 * (2 / departureRadiusAU - 1 / transferSemiMajor),
  )
  const transferArrival = Math.sqrt(
    SOLAR_GM_AU3_PER_DAY2 * (2 / arrivalRadiusAU - 1 / transferSemiMajor),
  )

  const departureDeltaVKmS = auPerDayToKmPerSecond(transferDeparture - circularDeparture)
  const arrivalDeltaVKmS = auPerDayToKmPerSecond(circularArrival - transferArrival)
  const transferTimeDays = Math.PI * Math.sqrt(
    transferSemiMajor ** 3 / SOLAR_GM_AU3_PER_DAY2,
  )

  return {
    model: 'circular-two-body',
    centralBody: 'Sun',
    direction,
    semiMajorAxisAU: transferSemiMajor,
    eccentricity,
    departureDeltaVKmS,
    arrivalDeltaVKmS,
    totalDeltaVKmS: Math.abs(departureDeltaVKmS) + Math.abs(arrivalDeltaVKmS),
    transferTimeDays,
    assumptions: [
      'coplanar circular endpoint orbits',
      'instantaneous impulses',
      'solar two-body gravity',
      'does not use the planets’ actual phase or eccentricity',
    ],
  }
}
