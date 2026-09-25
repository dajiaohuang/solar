import type { CelestialBody } from '../../types'
import { eventResolutionBodies } from './eventResolutionBodies'
const MAX_EVENT_SAMPLES = 720
const SAMPLES_PER_FASTEST_PERIOD = 36

function angularRateDegPerDay(body: CelestialBody) {
  if (!body.orbit) return 0
  if (body.orbit.model === 'keplerian') {
    const meanRate = Math.abs(body.orbit.meanMotionDegPerDay)
    const eccentricity = body.orbit.eccentricity
    // d(true anomaly)/dt peaks at periapsis for an elliptic Kepler orbit.
    // Mean motion alone can badly understate fast, eccentric comet passages.
    if (Number.isFinite(eccentricity) && eccentricity >= 0 && eccentricity < 1) {
      return meanRate * Math.sqrt(1 + eccentricity) / ((1 - eccentricity) ** 1.5)
    }
    return meanRate
  }
  return Math.abs(body.orbit.rates.meanLongitudeDeg / 36_525)
}

export type EventSamplingPlan = {
  requiredSamples: number
  actualSamples: number
  capped: boolean
  maximumResolvablePeriodDays: number
}

/** Interval fields describe UTC Julian-Day coordinates; ephemeris evaluation may use TDB. */
export type EventSamplingReceipt = {
  method: 'uniform-utc-julian-day-grid-v1'
  inputTimeScale: 'UTC'
  sampleCount: number
  startJulianDay: number
  endJulianDay: number
  nominalIntervalDays: number
  maximumIntervalDays: number
  eventCompletenessCertified: false
}

/** Return trajectories whose motion changes the requested event geometry. */
export function eventSamplingBodies(params: {
  bodies: readonly CelestialBody[]
  resolutionBodies: readonly CelestialBody[]
  referenceId: string
  eventKinds: readonly string[]
}): CelestialBody[] {
  // Include implicit state dependencies such as the Earth–Moon barycenter split.
  return eventResolutionBodies(params)
}

/** Bind a requested window to its actual representable closed sampling grid. */
export function eventSamplingReceipt(centerJulianDay: number, windowDays: number, sampleCount: number): EventSamplingReceipt {
  const startJulianDay = centerJulianDay - windowDays / 2
  const endJulianDay = centerJulianDay + windowDays / 2
  if (![centerJulianDay, windowDays, startJulianDay, endJulianDay].every(Number.isFinite) || windowDays <= 0 ||
      !(endJulianDay > startJulianDay) || !Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > MAX_EVENT_SAMPLES) {
    throw new RangeError('Event sampling grid requires a finite positive window and sample count')
  }
  let previous = startJulianDay, maximumIntervalDays = 0
  for (let index = 1; index < sampleCount; index += 1) {
    const julianDay = index === sampleCount - 1 ? endJulianDay
      : startJulianDay + index / (sampleCount - 1) * windowDays
    if (!(julianDay > previous)) throw new RangeError('Event sampling interval is below Julian Day numerical resolution')
    maximumIntervalDays = Math.max(maximumIntervalDays, julianDay - previous)
    previous = julianDay
  }
  return { method: 'uniform-utc-julian-day-grid-v1', inputTimeScale: 'UTC', sampleCount, startJulianDay, endJulianDay,
    nominalIntervalDays: windowDays / (sampleCount - 1), maximumIntervalDays, eventCompletenessCertified: false }
}

export function eventSamplingPlan(bodies: readonly CelestialBody[], windowDays: number, requested?: number): EventSamplingPlan {
  if (!Number.isFinite(windowDays) || windowDays < 0) throw new RangeError('Event window must be finite and non-negative')
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested <= 0)) throw new RangeError('Event sample count must be a positive integer')
  const normalizedWindowDays = Math.max(windowDays, 1 / 24)
  // Relative orbital phase can combine two moving trajectories. The two largest
  // peak rates estimate that change in O(n); they do not certify geometry between samples.
  let fastestRate = 0
  let secondFastestRate = 0
  const seenBodies = new Set<string>()
  for (const body of bodies) {
    if (seenBodies.has(body.id)) continue
    seenBodies.add(body.id)
    const rate = angularRateDegPerDay(body)
    if (!Number.isFinite(rate)) throw new RangeError(`Invalid angular rate for ${body.id}`)
    if (rate >= fastestRate) {
      secondFastestRate = fastestRate
      fastestRate = rate
    } else if (rate > secondFastestRate) secondFastestRate = rate
  }
  if (fastestRate === 0) fastestRate = 360 / 365.25
  const relativeOrbitalRateEstimate = fastestRate + secondFastestRate
  const targetIntervalDays = 360 / relativeOrbitalRateEstimate / SAMPLES_PER_FASTEST_PERIOD
  const intervalsNeeded = normalizedWindowDays / targetIntervalDays
  const requiredSamples = Number.isFinite(intervalsNeeded) && intervalsNeeded < Number.MAX_SAFE_INTEGER - 1
    ? Math.max(80, Math.ceil(intervalsNeeded) + 1)
    : Number.MAX_SAFE_INTEGER
  const requestedSamples = requested === undefined ? requiredSamples : Math.max(40, Math.trunc(requested))
  const actualSamples = Math.min(requestedSamples, MAX_EVENT_SAMPLES)
  // The exported cadence evidence must describe the actual scan interval.
  // The one-hour floor above is only a sample-count policy for tiny windows.
  const sampleIntervalDays = windowDays / Math.max(actualSamples - 1, 1)
  return {
    requiredSamples,
    actualSamples,
    capped: actualSamples < requiredSamples,
    maximumResolvablePeriodDays: sampleIntervalDays * SAMPLES_PER_FASTEST_PERIOD,
  }
}

export function adaptiveEventSampleCount(bodies: readonly CelestialBody[], windowDays: number, requested?: number) {
  return eventSamplingPlan(bodies, windowDays, requested).actualSamples
}
