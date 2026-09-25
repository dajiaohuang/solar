/// <reference lib="webworker" />

import {
  subtractVector3,
  vector3Magnitude,
} from '../lib/ephemeris'
import { angularSeparationDeg } from '../engine/events/angularSeparation'
import { eventSamplingReceipt, type EventSamplingReceipt } from '../engine/events/eventSampling'
import { findSampledExtrema, refineBracketedExtremum, type ExtremumMode, type SampledExtremum } from '../engine/events/sampledExtrema'
import { admitEventAnalysis, MAX_ANALYSIS_EVENTS, MAX_EVENT_REFINEMENTS } from '../engine/events/eventAnalysisLimits'
import { assertEventRequestBudget } from '../engine/events/eventRequestBudget'
import type { BodyId, CelestialBody, Vector3 } from '../types'
import { ensureKernelFiles, kernelsForWindow } from '../engine/ephemeris/kernelStore'
import { createAnalysisEphemeris, type AnalysisEphemerisEvidence, type AnalysisEphemerisPolicy } from '../engine/ephemeris/analysisEphemeris'

export type EventKind = 'close-approach' | 'conjunction' | 'opposition' | 'perihelion' | 'aphelion' | 'periapsis' | 'apoapsis'

export type EventAnalysisRequest = {
  type: 'run'
  ephemerisFiles?: string[]
  ephemerisPolicy?: AnalysisEphemerisPolicy
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
  model: 'sampled-ephemeris-local-refinement-v7'
  ephemerisFiles: string[]
  ephemeris: Pick<AnalysisEphemerisEvidence, 'policy' | 'bodies'>
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
  ephemeris?: AnalysisEphemerisEvidence
  sampling?: EventSamplingReceipt
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

function apsisKinds(body: Pick<CelestialBody, 'parentId'>) {
  const centralBodyId = body.parentId ?? 'sun'
  return {
    centralBodyId,
    minimumKind: centralBodyId === 'sun' ? 'perihelion' as const : 'periapsis' as const,
    maximumKind: centralBodyId === 'sun' ? 'aphelion' as const : 'apoapsis' as const,
  }
}

async function runAnalysis(request: EventAnalysisRequest) {
  activeRequestId = request.requestId
  assertEventRequestBudget(request)
  const sampleCount = admitEventAnalysis(request)
  const sampling = eventSamplingReceipt(request.centerJulianDay, request.windowDays, sampleCount)
  await ensureKernelFiles(request.ephemerisFiles ?? [])
  if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
    workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies EventAnalysisResponse)
    return
  }
  const kernels = kernelsForWindow(request.centerJulianDay - request.windowDays / 2, request.centerJulianDay + request.windowDays / 2, request.ephemerisFiles ?? [])
  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const ephemeris = createAnalysisEphemeris({ bodiesById, kernels, policy: request.ephemerisPolicy,
    startJulianDay: request.centerJulianDay - request.windowDays / 2,
    endJulianDay: request.centerJulianDay + request.windowDays / 2 })
  const createBodyPositionResolver = (_bodies: Map<BodyId, CelestialBody>, jd: number) => ephemeris.at(jd).position
  const needsDistances = request.eventKinds.includes('close-approach')
  const needsAngles = request.eventKinds.some(kind => kind === 'conjunction' || kind === 'opposition')
  const needsPairs = needsDistances || needsAngles
  const needsApsides = request.eventKinds.some(kind => ['perihelion', 'aphelion', 'periapsis', 'apoapsis'].includes(kind))
  const startJulianDay = sampling.startJulianDay
  const positions = new Map<BodyId, Vector3[]>(request.bodies.map((body) => [body.id, []]))
  const centralBodyIds = new Set(needsApsides ? request.bodies.filter(body => body.id !== 'sun').flatMap(body => {
    const { centralBodyId, minimumKind, maximumKind } = apsisKinds(body)
    return request.eventKinds.includes(minimumKind) || request.eventKinds.includes(maximumKind) ? [centralBodyId] : []
  }) : [])
  const centralPositions = new Map<BodyId, Vector3[]>([...centralBodyIds].map((bodyId) => [bodyId, []]))
  const referencePositions: Vector3[] = []
  const julianDays: number[] = []
  const sampleIntervalDays = sampling.nominalIntervalDays

  let refinements = 0
  const refine = (candidate: SampledExtremum, mode: ExtremumMode, evaluate: (julianDay: number) => number) => {
    if (++refinements > MAX_EVENT_REFINEMENTS) throw new RangeError('Event refinement budget exceeded; request fewer bodies or a shorter window')
    const refined = refineBracketedExtremum(
      julianDays[candidate.bracketStartIndex],
      julianDays[candidate.bracketEndIndex],
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
    const jd = sample === sampleCount - 1 ? sampling.endJulianDay
      : startJulianDay + sample / (sampleCount - 1) * request.windowDays
    const resolve = createBodyPositionResolver(bodiesById, jd)
    julianDays.push(jd)
    if (needsAngles) referencePositions.push(resolve(request.referenceId))
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
  const appendEvent = (event: AnalysisEvent) => {
    if (events.length >= MAX_ANALYSIS_EVENTS) throw new RangeError('Event result budget exceeded; request fewer bodies or a shorter window')
    events.push(event)
  }
  const pairCount = request.bodies.length * Math.max(0, request.bodies.length - 1) / 2
  let processedPairs = 0
  for (let first = 0; needsPairs && first < request.bodies.length; first += 1) {
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
        if (needsDistances) distances.push(vector3Magnitude(subtractVector3(trackA[sample], trackB[sample])))
        if (needsAngles) {
          const relativeA = subtractVector3(trackA[sample], referencePositions[sample])
          const relativeB = subtractVector3(trackB[sample], referencePositions[sample])
          angles.push(angularSeparationDeg(relativeA, relativeB))
        }
      }

      const base = {
        bodyAId: bodyA.id,
        bodyAName: bodyA.name,
        bodyBId: bodyB.id,
        bodyBName: bodyB.name,
        model: 'sampled-ephemeris-local-refinement-v7' as const,
        ephemerisFiles: kernels.map((kernel) => kernel.id),
        ephemeris: { policy: request.ephemerisPolicy ?? 'prefer-spk', bodies: ephemeris.bodyModels([bodyA.id, bodyB.id, ...(needsAngles ? [request.referenceId] : [])]) },
      }
      if (request.eventKinds.includes('close-approach')) {
        for (const extremum of findSampledExtrema(distances, 'minimum')) {
          const refined = refine(extremum, 'minimum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            return vector3Magnitude(subtractVector3(resolve(bodyA.id), resolve(bodyB.id)))
          })
          if (refined.value <= request.thresholdAU) {
            appendEvent({ ...base, kind: 'close-approach', unit: 'AU', ...refined })
          }
        }
      }
      if (request.eventKinds.includes('conjunction')) {
        for (const extremum of findSampledExtrema(angles, 'minimum')) {
          const refined = refine(extremum, 'minimum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            const reference = resolve(request.referenceId)
            return angularSeparationDeg(subtractVector3(resolve(bodyA.id), reference), subtractVector3(resolve(bodyB.id), reference))
          })
          if (refined.value <= 2) {
            appendEvent({ ...base, kind: 'conjunction', unit: 'deg', ...refined })
          }
        }
      }
      if (request.eventKinds.includes('opposition')) {
        for (const extremum of findSampledExtrema(angles, 'maximum')) {
          const refined = refine(extremum, 'maximum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            const reference = resolve(request.referenceId)
            return angularSeparationDeg(subtractVector3(resolve(bodyA.id), reference), subtractVector3(resolve(bodyB.id), reference))
          })
          if (refined.value >= 178) {
            appendEvent({ ...base, kind: 'opposition', unit: 'deg', ...refined })
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

  if (needsApsides) {
    for (const body of request.bodies) {
      if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
        workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies EventAnalysisResponse)
        return
      }
      if (body.id === 'sun') continue
      const { centralBodyId, minimumKind, maximumKind } = apsisKinds(body)
      const findMinimum = request.eventKinds.includes(minimumKind)
      const findMaximum = request.eventKinds.includes(maximumKind)
      if (!findMinimum && !findMaximum) continue
      const centralBody = bodiesById.get(centralBodyId)
      const centralTrack = centralPositions.get(centralBodyId) ?? []
      const track = positions.get(body.id) ?? []
      const radii: number[] = []
      for (let sample = 0; sample < sampleCount; sample += 1) {
        radii.push(vector3Magnitude(subtractVector3(track[sample], centralTrack[sample])))
      }
      const base = {
        bodyAId: body.id, bodyAName: body.name, centralBodyId, centralBodyName: centralBody?.name ?? centralBodyId,
        model: 'sampled-ephemeris-local-refinement-v7' as const,
        ephemerisFiles: kernels.map((kernel) => kernel.id),
        ephemeris: { policy: request.ephemerisPolicy ?? 'prefer-spk', bodies: ephemeris.bodyModels([body.id, centralBodyId]) },
      }
      if (findMinimum) {
        for (const extremum of findSampledExtrema(radii, 'minimum')) {
          const refined = refine(extremum, 'minimum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            return vector3Magnitude(subtractVector3(resolve(body.id), resolve(centralBodyId)))
          })
          appendEvent({ ...base, kind: minimumKind, unit: 'AU', ...refined })
        }
      }
      if (findMaximum) {
        for (const extremum of findSampledExtrema(radii, 'maximum')) {
          const refined = refine(extremum, 'maximum', (julianDay) => {
            const resolve = createBodyPositionResolver(bodiesById, julianDay)
            return vector3Magnitude(subtractVector3(resolve(body.id), resolve(centralBodyId)))
          })
          appendEvent({ ...base, kind: maximumKind, unit: 'AU', ...refined })
        }
      }
      await yieldToWorker()
    }
  }

  if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
    workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies EventAnalysisResponse)
    return
  }
  events.sort((a, b) => a.julianDay - b.julianDay)
  workerScope.postMessage({ type: 'result', requestId: request.requestId, progress: 1, events, ephemeris: ephemeris.evidence(), sampling } satisfies EventAnalysisResponse)
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
