import type { CelestialBody } from '../../types'

function angularRateDegPerDay(body: CelestialBody) {
  if (!body.orbit) return 0
  if (body.orbit.model === 'keplerian') return Math.abs(body.orbit.meanMotionDegPerDay)
  return Math.abs(body.orbit.rates.meanLongitudeDeg / 36_525)
}

export type EventSamplingPlan = {
  requiredSamples: number
  actualSamples: number
  capped: boolean
  maximumResolvablePeriodDays: number
}

const MAX_EVENT_SAMPLES = 720
const SAMPLES_PER_FASTEST_PERIOD = 36

export function eventSamplingPlan(bodies: readonly CelestialBody[], windowDays: number, requested?: number): EventSamplingPlan {
  if (!Number.isFinite(windowDays) || windowDays < 0) throw new RangeError('Event window must be finite and non-negative')
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested <= 0)) throw new RangeError('Event sample count must be a positive integer')
  const normalizedWindowDays = Math.max(windowDays, 1 / 24)
  // Rates are absolute: |a - b| <= max(a, b). Pairwise comparisons cannot
  // increase the maximum and made every UI render quadratic in body count.
  let fastestRate = 0
  for (const body of bodies) {
    const rate = angularRateDegPerDay(body)
    if (!Number.isFinite(rate)) throw new RangeError(`Invalid angular rate for ${body.id}`)
    fastestRate = Math.max(fastestRate, rate)
  }
  if (fastestRate === 0) fastestRate = 360 / 365.25
  const targetIntervalDays = 360 / fastestRate / SAMPLES_PER_FASTEST_PERIOD
  const requiredSamples = Math.max(80, Math.ceil(normalizedWindowDays / Math.max(targetIntervalDays, 1 / 24)) + 1)
  const requestedSamples = requested === undefined ? requiredSamples : Math.max(40, Math.trunc(requested))
  const actualSamples = Math.min(requestedSamples, MAX_EVENT_SAMPLES)
  const sampleIntervalDays = normalizedWindowDays / Math.max(actualSamples - 1, 1)
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
