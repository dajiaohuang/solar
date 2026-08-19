/// <reference lib="webworker" />

import {
  createBodyPositionResolver,
  dotVector3,
  subtractVector3,
  vector3Magnitude,
} from '../lib/ephemeris'
import { extremumJulianDay, findSampledExtrema } from '../engine/events/sampledExtrema'
import type { BodyId, CelestialBody, Vector3 } from '../types'

export type EventKind = 'close-approach' | 'conjunction' | 'opposition' | 'perihelion' | 'aphelion'

export type EventAnalysisRequest = {
  type: 'run'
  requestId: number
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: BodyId
  centerJulianDay: number
  windowDays: number
  thresholdAU: number
  eventKinds: EventKind[]
  sampleCount?: number
}

export type EventAnalysisCancel = { type: 'cancel'; requestId: number }

export type AnalysisEvent = {
  kind: EventKind
  bodyAId: BodyId
  bodyAName: string
  bodyBId?: BodyId
  bodyBName?: string
  value: number
  unit: 'AU' | 'deg'
  julianDay: number
  model: 'sampled-two-body-parabolic'
}

export type EventAnalysisResponse = {
  type: 'progress' | 'result' | 'cancelled' | 'error'
  requestId: number
  progress?: number
  events?: AnalysisEvent[]
  error?: string
}

// Compatibility aliases retained for consumers of the original panel.
export type ConjunctionRequest = EventAnalysisRequest
export type ConjunctionEvent = AnalysisEvent
export type ConjunctionResponse = EventAnalysisResponse

const workerScope = self as DedicatedWorkerGlobalScope
let activeRequestId = 0
let cancelledRequestId = 0

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function angleDeg(a: Vector3, b: Vector3) {
  const denominator = vector3Magnitude(a) * vector3Magnitude(b)
  if (denominator < 1e-15) return Number.NaN
  const cosine = Math.max(-1, Math.min(1, dotVector3(a, b) / denominator))
  return Math.acos(cosine) * 180 / Math.PI
}

async function runAnalysis(request: EventAnalysisRequest) {
  activeRequestId = request.requestId
  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const sampleCount = Math.max(40, Math.min(request.sampleCount ?? 240, 720))
  const startJulianDay = request.centerJulianDay - request.windowDays / 2
  const positions = new Map<BodyId, Vector3[]>(request.bodies.map((body) => [body.id, []]))
  const referencePositions: Vector3[] = []
  const julianDays: number[] = []

  for (let sample = 0; sample < sampleCount; sample += 1) {
    if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
      workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies EventAnalysisResponse)
      return
    }
    const jd = startJulianDay + sample / (sampleCount - 1) * request.windowDays
    const resolve = createBodyPositionResolver(bodiesById, jd)
    julianDays.push(jd)
    referencePositions.push(resolve(request.referenceId))
    for (const body of request.bodies) positions.get(body.id)?.push(resolve(body.id))
    if (sample % 12 === 0) {
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        progress: 0.25 * sample / sampleCount,
      } satisfies EventAnalysisResponse)
      await yieldToWorker()
    }
  }

  const events: AnalysisEvent[] = []
  const pairCount = request.bodies.length * Math.max(0, request.bodies.length - 1) / 2
  let processedPairs = 0
  for (let first = 0; first < request.bodies.length; first += 1) {
    for (let second = first + 1; second < request.bodies.length; second += 1) {
      if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
        workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies EventAnalysisResponse)
        return
      }
      const bodyA = request.bodies[first]
      const bodyB = request.bodies[second]
      const trackA = positions.get(bodyA.id) ?? []
      const trackB = positions.get(bodyB.id) ?? []
      const distances: number[] = []
      const angles: number[] = []
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const distance = vector3Magnitude(subtractVector3(trackA[sample], trackB[sample]))
        distances.push(distance)
        const relativeA = subtractVector3(trackA[sample], referencePositions[sample])
        const relativeB = subtractVector3(trackB[sample], referencePositions[sample])
        angles.push(angleDeg(relativeA, relativeB))
      }

      const base = {
        bodyAId: bodyA.id,
        bodyAName: bodyA.name,
        bodyBId: bodyB.id,
        bodyBName: bodyB.name,
        model: 'sampled-two-body-parabolic' as const,
      }
      if (request.eventKinds.includes('close-approach')) {
        for (const extremum of findSampledExtrema(distances, 'minimum')) {
          if (extremum.value <= request.thresholdAU) {
            events.push({ ...base, kind: 'close-approach', value: extremum.value, unit: 'AU', julianDay: extremumJulianDay(julianDays, extremum) })
          }
        }
      }
      if (request.eventKinds.includes('conjunction')) {
        for (const extremum of findSampledExtrema(angles, 'minimum')) {
          if (extremum.value <= 2) {
            events.push({ ...base, kind: 'conjunction', value: extremum.value, unit: 'deg', julianDay: extremumJulianDay(julianDays, extremum) })
          }
        }
      }
      if (request.eventKinds.includes('opposition')) {
        for (const extremum of findSampledExtrema(angles, 'maximum')) {
          if (extremum.value >= 178) {
            events.push({ ...base, kind: 'opposition', value: extremum.value, unit: 'deg', julianDay: extremumJulianDay(julianDays, extremum) })
          }
        }
      }

      processedPairs += 1
      if (processedPairs % 8 === 0) {
        workerScope.postMessage({
          type: 'progress',
          requestId: request.requestId,
          progress: 0.25 + 0.65 * processedPairs / Math.max(pairCount, 1),
        } satisfies EventAnalysisResponse)
        await yieldToWorker()
      }
    }
  }

  if (request.eventKinds.includes('perihelion') || request.eventKinds.includes('aphelion')) {
    const sunTrack = request.bodies.some((body) => body.id === 'sun')
      ? positions.get('sun') ?? []
      : julianDays.map((jd) => createBodyPositionResolver(bodiesById, jd)('sun'))
    for (const body of request.bodies) {
      if (body.id === 'sun') continue
      const track = positions.get(body.id) ?? []
      const radii: number[] = []
      for (let sample = 0; sample < sampleCount; sample += 1) {
        radii.push(vector3Magnitude(subtractVector3(track[sample], sunTrack[sample])))
      }
      const base = { bodyAId: body.id, bodyAName: body.name, model: 'sampled-two-body-parabolic' as const }
      if (request.eventKinds.includes('perihelion')) {
        for (const extremum of findSampledExtrema(radii, 'minimum')) {
          events.push({ ...base, kind: 'perihelion', value: extremum.value, unit: 'AU', julianDay: extremumJulianDay(julianDays, extremum) })
        }
      }
      if (request.eventKinds.includes('aphelion')) {
        for (const extremum of findSampledExtrema(radii, 'maximum')) {
          events.push({ ...base, kind: 'aphelion', value: extremum.value, unit: 'AU', julianDay: extremumJulianDay(julianDays, extremum) })
        }
      }
    }
  }

  events.sort((a, b) => a.julianDay - b.julianDay)
  workerScope.postMessage({ type: 'result', requestId: request.requestId, progress: 1, events } satisfies EventAnalysisResponse)
}

workerScope.onmessage = (event: MessageEvent<EventAnalysisRequest | EventAnalysisCancel>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelledRequestId = request.requestId
    return
  }
  void runAnalysis(request).catch((error: unknown) => {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies EventAnalysisResponse)
  })
}

export {}
