import { CATALOG_ELEMENT_STRIDE } from './catalogPoints'
import { utcJulianDayIntervalTtDays, utcJulianDayToTt } from './timeScales'

/** Per-orbit periapsis speed from the unchanged MPC two-body source elements. */
export function catalogOrbitMaximumSpeedAUPerTtDay(a: number, e: number, meanMotionDegPerDay: number): number | null {
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(e) || e < 0 || e >= 1 ||
      !Number.isFinite(meanMotionDegPerDay) || meanMotionDegPerDay <= 0) return null
  const speed = a * (meanMotionDegPerDay * (Math.PI / 180)) * Math.sqrt((1 + e) / (1 - e))
  return Number.isFinite(speed) && speed > 0 ? speed : null
}

/** Applies the existing rounding allowance to an accumulated speed maximum. */
export function catalogSpeedUpperBoundAUPerTtDay(maximumSpeed: number): number | null {
  if (!Number.isFinite(maximumSpeed) || maximumSpeed <= 0) return null
  const padded = maximumSpeed * (1 + 64 * Number.EPSILON)
  return Number.isFinite(padded) ? padded : null
}

/** Global speed cap for the unchanged source's elliptic two-body model.
 * Vis-viva at periapsis, using the source mean motion: a*n*sqrt((1+e)/(1-e)).
 * This bounds temporal model displacement, not physical or floating-point error.
 * Unsupported/overflowing inputs disable reuse and leave validation to compute. */
export function catalogMaximumSpeedAUPerTtDay(elements: Float64Array): number | null {
  if (!elements.length || elements.length % CATALOG_ELEMENT_STRIDE) return null
  let maximum = 0
  for (let offset = 0; offset < elements.length; offset += CATALOG_ELEMENT_STRIDE) {
    const speed = catalogOrbitMaximumSpeedAUPerTtDay(elements[offset + 1], elements[offset + 2], elements[offset + 7])
    if (speed === null) return null
    maximum = Math.max(maximum, speed)
  }
  return catalogSpeedUpperBoundAUPerTtDay(maximum)
}

export function catalogTemporalDisplacementAU(fromUtc: number, toUtc: number, maximumSpeed: number | null): number | null {
  if (![fromUtc, toUtc].every(Number.isFinite) || Math.min(fromUtc, toUtc) < 2441317.5) return null
  if (fromUtc === toUtc) return 0
  if (maximumSpeed === null || !Number.isFinite(maximumSpeed) || maximumSpeed <= 0) return null
  // TT, including the leap-second offset, is the source model's independent time.
  // Retain the larger interval from the directly differenced UTC/leap parts
  // and the rounded TT dates actually consumed by catalog propagation.
  const elapsed = Math.max(Math.abs(utcJulianDayIntervalTtDays(fromUtc, toUtc)),
    Math.abs(utcJulianDayToTt(toUtc) - utcJulianDayToTt(fromUtc)))
  const displacement = maximumSpeed * elapsed * (1 + 64 * Number.EPSILON)
  return Number.isFinite(displacement) && displacement > 0 ? displacement : null
}
