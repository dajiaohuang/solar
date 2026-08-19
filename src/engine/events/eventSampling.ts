import type { CelestialBody } from '../../types'

function angularRateDegPerDay(body: CelestialBody) {
  if (!body.orbit) return 0
  if (body.orbit.model === 'keplerian') return Math.abs(body.orbit.meanMotionDegPerDay)
  return Math.abs(body.orbit.rates.meanLongitudeDeg / 36_525)
}

export function adaptiveEventSampleCount(bodies: readonly CelestialBody[], windowDays: number, requested?: number) {
  if (requested !== undefined) return Math.max(40, Math.min(Math.trunc(requested), 720))
  const rates = bodies.map(angularRateDegPerDay).filter((rate) => rate > 0)
  let fastestRate = rates.length ? Math.max(...rates) : 360 / 365.25
  for (let first = 0; first < rates.length; first += 1) {
    for (let second = first + 1; second < rates.length; second += 1) {
      fastestRate = Math.max(fastestRate, Math.abs(rates[first] - rates[second]))
    }
  }
  const targetIntervalDays = 360 / fastestRate / 36
  return Math.max(80, Math.min(720, Math.ceil(windowDays / Math.max(targetIntervalDays, 1 / 24)) + 1))
}
