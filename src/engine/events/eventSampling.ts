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
  const normalizedWindowDays = Math.max(windowDays, 1 / 24)
  const rates = bodies.map(angularRateDegPerDay).filter((rate) => rate > 0)
  let fastestRate = rates.length ? Math.max(...rates) : 360 / 365.25
  for (let first = 0; first < rates.length; first += 1) {
    for (let second = first + 1; second < rates.length; second += 1) {
      fastestRate = Math.max(fastestRate, Math.abs(rates[first] - rates[second]))
    }
  }
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
