import { adaptiveEventSampleCount, eventSamplingBodies, eventSamplingReceipt } from './eventSampling'
import type { CelestialBody } from '../../types'

export const MAX_EVENT_BODIES = 48
export const MAX_ANALYSIS_EVENTS = 10_000
export const MAX_EVENT_REFINEMENTS = 50_000
const KINDS = new Set(['close-approach', 'conjunction', 'opposition', 'perihelion', 'aphelion', 'periapsis', 'apoapsis'])

/** Admission policy, not an accuracy or completeness certificate. */
export function admitEventAnalysis(request: {
  bodies: CelestialBody[]; resolutionBodies: CelestialBody[]; referenceId: string
  centerJulianDay: number; windowDays: number
  thresholdAU: number; eventKinds: string[]; sampleCount?: number
}) {
  if (!Array.isArray(request.bodies) || request.bodies.length < 1 || request.bodies.length > MAX_EVENT_BODIES) {
    throw new RangeError(`Event analysis requires 1–${MAX_EVENT_BODIES} bodies`)
  }
  const ids = new Set<string>()
  for (const body of request.bodies) {
    if (!body || typeof body.id !== 'string' || !body.id || ids.has(body.id)) throw new RangeError('Event analysis requires distinct body identities')
    ids.add(body.id)
  }
  const start = request.centerJulianDay - request.windowDays / 2
  const end = request.centerJulianDay + request.windowDays / 2
  if (![request.centerJulianDay, request.windowDays, start, end, request.thresholdAU].every(Number.isFinite) ||
      request.windowDays <= 0 || end <= start || request.thresholdAU < 0) {
    throw new RangeError('Event window must be finite with positive width and a nonnegative distance threshold')
  }
  if (!Array.isArray(request.eventKinds) || !request.eventKinds.length || request.eventKinds.length > KINDS.size ||
      new Set(request.eventKinds).size !== request.eventKinds.length || request.eventKinds.some(kind => !KINDS.has(kind))) {
    throw new RangeError('Event analysis requires distinct supported event kinds')
  }
  const samplingBodies = eventSamplingBodies(request)
  const sampleCount = adaptiveEventSampleCount(samplingBodies, request.windowDays, request.sampleCount)
  eventSamplingReceipt(request.centerJulianDay, request.windowDays, sampleCount)
  return sampleCount
}
