import { CATALOG_ELEMENT_STRIDE } from './catalogPoints'
import { utcJulianDayToTt } from './timeScales'

/** Global speed cap for the unchanged source's elliptic two-body model.
 * Vis-viva at periapsis, using the source mean motion: a*n*sqrt((1+e)/(1-e)).
 * This bounds temporal model displacement, not physical or floating-point error.
 * Unsupported/overflowing inputs disable reuse and leave validation to compute. */
export function catalogMaximumSpeedAUPerTtDay(elements: Float64Array): number | null {
  if (!elements.length || elements.length % CATALOG_ELEMENT_STRIDE) return null
  let maximum = 0
  for (let offset = 0; offset < elements.length; offset += CATALOG_ELEMENT_STRIDE) {
    const a = elements[offset + 1], e = elements[offset + 2], n = elements[offset + 7] * (Math.PI / 180)
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(e) || e < 0 || e >= 1 || !Number.isFinite(n) || n <= 0) return null
    const speed = a * n * Math.sqrt((1 + e) / (1 - e))
    if (!Number.isFinite(speed) || speed <= 0) return null
    maximum = Math.max(maximum, speed)
  }
  const padded = maximum * (1 + 64 * Number.EPSILON)
  return Number.isFinite(padded) ? padded : null
}

export function catalogTemporalDisplacementAU(fromUtc: number, toUtc: number, maximumSpeed: number | null): number | null {
  if (![fromUtc, toUtc].every(Number.isFinite)) return null
  if (fromUtc === toUtc) return 0
  if (maximumSpeed === null || !Number.isFinite(maximumSpeed) || maximumSpeed <= 0 || Math.min(fromUtc, toUtc) < 2441317.5) return null
  // TT, including the leap-second offset, is the source model's independent time.
  const elapsed = Math.abs(utcJulianDayToTt(toUtc) - utcJulianDayToTt(fromUtc))
  const displacement = maximumSpeed * elapsed
  return Number.isFinite(displacement) ? displacement : null
}
