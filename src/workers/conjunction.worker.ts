/// <reference lib="webworker" />

import {
  createBodyPositionResolver as createResolver,
  dotVector3,
  subtractVector3,
  vector3Magnitude,
} from '../lib/ephemeris'
import { findSampledExtrema, refineBracketedExtremum, type ExtremumMode } from '../engine/events/sampledExtrema'
import { adaptiveEventSampleCount } from '../engine/events/eventSampling'
import type { BodyId, CelestialBody, Vector3 } from '../types'
import { ensureKernelFiles, kernelsForWindow } from '../engine/ephemeris/kernelStore'

export type EventKind = 'close-approach' | 'conjunction' | 'opposition' | 'perihelion' | 'aphelion' | 'periapsis' | 'apoapsis'

export type EventAnalysisRequest = {
  type: 'run'
  ephemerisFiles?: string[]
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
  centralBodyId?: BodyId
  centralBodyName?: string
  value: number
  unit: 'AU' | 'deg'
  julianDay: number
  model: 'sampled-ephemeris-local-refinement-v4'
  ephemerisFiles: string[]
  sampleIntervalDays: number
  numericalRefinementHalfWidthDays: number
  physicalPredictionUncertainty: 'not-estimated'
  refinementIterations: number
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
  await ensureKernelFiles(request.ephemerisFiles ?? [])
  const kernels = kernelsForWindow(request.centerJulianDay - request.windowDays / 2, request.centerJulianDay + request.windowDays / 2, request.ephemerisFiles ?? [])
  const createBodyPositionResolver = (bodies: Map<BodyId, CelestialBody>, jd: number) => createResolver(bodies, jd, kernels)
  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const sampleCount = adaptiveEventSampleCount(request.bodies, request.windowDays, request.sampleCount)
  const startJulianDay = request.centerJulianDay - request.windowDays / 2
  const positions = new Map<BodyId, Vector3[]>(request.bodies.map((body) => [body.id, []]))
  const centralBodyIds = new Set(request.bodies.filter((body) => body.id !== 'sun').map((body) => body.parentId ?? 'sun'))
  const centralPositions = new Map<BodyId, Vector3[]>([...centralBodyIds].map((bodyId) => [bodyId, []]))
  const referencePositions: Vector3[] = []
  const julianDays: number[] = []
  const sampleIntervalDays = request.windowDays / Math.max(sampleCount - 1, 1)

  const refine = (sampleIndex: number, mode: ExtremumMode, evaluate: (julianDay: number) => number) => {
    const refined = refineBracketedExtremum(
      julianDays[sampleIndex - 1],
      julianDays[sampleIndex + 1],
      mode,
      evaluate,
    )
    return {
      value: refined.value,
      julianDay: refined.julianDay,
      sampleIntervalDays,
      numericalRefinementHalfWidthDays: refined.numericalRefinementHalfWidthDays,
      physicalPredictionUncertainty: 'not-estimated' as const,
      refinementIterations: refined.iterations,
    }
  }

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
    for (const centralBodyId of centralBodyIds) centralPositions.get(centralBodyId)?.push(resolve(centralBodyId))
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
        model: 'sampled-ephemeris-local-refinement-v4' as const,
        ephemerisFiles: kernels.map((kernel) => kernel.id),
      }
      if (request.eventKinds.includes('close-approach')) {
        for (const extremum of findSampledExtrema(distances, 'minimum')) {
          const refined = refine(extremum.sampleIndex, 'minimum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            return vector3Magnitude(subtractVector3(resolve(bodyA.id), resolve(bodyB.id)))
          })
          if (refined.value <= request.thresholdAU) {
            events.push({ ...base, kind: 'close-approach', unit: 'AU', ...refined })
          }
        }
      }
      if (request.eventKinds.includes('conjunction')) {
        for (const extremum of findSampledExtrema(angles, 'minimum')) {
          const refined = refine(extremum.sampleIndex, 'minimum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            const reference = resolve(request.referenceId)
            return angleDeg(subtractVector3(resolve(bodyA.id), reference), subtractVector3(resolve(bodyB.id), reference))
          })
          if (refined.value <= 2) {
            events.push({ ...base, kind: 'conjunction', unit: 'deg', ...refined })
          }
        }
      }
      if (request.eventKinds.includes('opposition')) {
        for (const extremum of findSampledExtrema(angles, 'maximum')) {
          const refined = refine(extremum.sampleIndex, 'maximum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            const reference = resolve(request.referenceId)
            return angleDeg(subtractVector3(resolve(bodyA.id), reference), subtractVector3(resolve(bodyB.id), reference))
          })
          if (refined.value >= 178) {
            events.push({ ...base, kind: 'opposition', unit: 'deg', ...refined })
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

  if (request.eventKinds.some((kind) => ['perihelion', 'aphelion', 'periapsis', 'apoapsis'].includes(kind))) {
    for (const body of request.bodies) {
      if (body.id === 'sun') continue
      const centralBodyId = body.parentId ?? 'sun'
      const centralBody = bodiesById.get(centralBodyId)
      const centralTrack = centralPositions.get(centralBodyId) ?? []
      const track = positions.get(body.id) ?? []
      const radii: number[] = []
      for (let sample = 0; sample < sampleCount; sample += 1) {
        radii.push(vector3Magnitude(subtractVector3(track[sample], centralTrack[sample])))
      }
      const base = {
        bodyAId: body.id, bodyAName: body.name, centralBodyId, centralBodyName: centralBody?.name ?? centralBodyId,
        model: 'sampled-ephemeris-local-refinement-v4' as const,
        ephemerisFiles: kernels.map((kernel) => kernel.id),
      }
      if (request.eventKinds.includes('perihelion') || request.eventKinds.includes('periapsis')) {
        for (const extremum of findSampledExtrema(radii, 'minimum')) {
          const refined = refine(extremum.sampleIndex, 'minimum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            return vector3Magnitude(subtractVector3(resolve(body.id), resolve(centralBodyId)))
          })
          events.push({ ...base, kind: body.parentId ? 'periapsis' : 'perihelion', unit: 'AU', ...refined })
        }
      }
      if (request.eventKinds.includes('aphelion') || request.eventKinds.includes('apoapsis')) {
        for (const extremum of findSampledExtrema(radii, 'maximum')) {
          const refined = refine(extremum.sampleIndex, 'maximum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            return vector3Magnitude(subtractVector3(resolve(body.id), resolve(centralBodyId)))
          })
          events.push({ ...base, kind: body.parentId ? 'apoapsis' : 'aphelion', unit: 'AU', ...refined })
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
