import { useCallback, useEffect, useRef, useState } from 'react'
import type { CelestialBody } from '../types'
import { kernelFilesForBodies, EPHEMERIS_MANIFEST } from '../engine/ephemeris/kernelStore'
import { adaptiveEventSampleCount, eventSamplingBodies } from '../engine/events/eventSampling'
import type { EventSamplingReceipt } from '../engine/events/eventSampling'
import { admitEventAnalysis, MAX_ANALYSIS_EVENTS } from '../engine/events/eventAnalysisLimits'
import { eventResolutionBodies } from '../engine/events/eventResolutionBodies'
import { assertEventRequestBudget } from '../engine/events/eventRequestBudget'
import { assertEventResultBinding } from '../engine/events/eventResultBinding'
import { managedEphemerisWorker } from '../lib/managedEphemerisWorker'
import type { AnalysisEphemerisEvidence, AnalysisEphemerisPolicy } from '../engine/ephemeris/analysisEphemeris'
import type {
  AnalysisEvent,
  EventAnalysisRequest,
  EventAnalysisResponse,
  EventKind,
} from '../workers/conjunction.worker'

export type RunEventAnalysisParams = {
  ephemerisPolicy?: AnalysisEphemerisPolicy
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: string
  centerJulianDay: number
  windowDays: number
  thresholdAU: number
  eventKinds: EventKind[]
  sampleCount?: number
}

function eventKernelFiles(params: RunEventAnalysisParams) {
  return kernelFilesForBodies([...params.bodies, ...params.resolutionBodies])
}

type CachedEventAnalysis = {
  events: AnalysisEvent[]
  ephemeris: AnalysisEphemerisEvidence | null
  sampling: EventSamplingReceipt
}

const EVENT_CACHE_LIMIT = 8
const EVENT_CACHE_BYTE_LIMIT = 16 * 1024 * 1024
const eventAnalysisCache = new Map<string, CachedEventAnalysis>()
const cacheWeights = new Map<string, number>()
let cachedBytes = 0

// Conservative accounting policy for plain result objects, not a JS heap
// measurement. Walk incrementally instead of serializing a second full copy.
function cacheWeight(key: string, entry: CachedEventAnalysis): number {
  let bytes = key.length * 2 + 128
  const seen = new WeakSet<object>()
  const visit = (value: unknown, depth: number): void => {
    if (bytes > EVENT_CACHE_BYTE_LIMIT) return
    if (typeof value === 'string') { bytes += 24 + value.length * 2; return }
    if (value === null || typeof value !== 'object') { bytes += 8; return }
    if (seen.has(value)) return
    if (depth > 64) { bytes = Infinity; return }
    seen.add(value)
    bytes += 64
    for (const property in value) {
      if (!Object.hasOwn(value, property)) continue
      bytes += 16 + property.length * 2
      visit((value as Record<string, unknown>)[property], depth + 1)
      if (bytes > EVENT_CACHE_BYTE_LIMIT) return
    }
  }
  visit(entry, 0)
  return bytes
}

function deleteCachedAnalysis(key: string) {
  cachedBytes -= cacheWeights.get(key) ?? 0
  cacheWeights.delete(key)
  eventAnalysisCache.delete(key)
}

function cloneParams(params: RunEventAnalysisParams): RunEventAnalysisParams {
  const selected = {
    ...params,
    resolutionBodies: eventResolutionBodies(params),
  }
  assertEventRequestBudget(selected)
  return structuredClone(selected)
}

export function eventAnalysisCacheKey(params: RunEventAnalysisParams, ephemerisFiles = eventKernelFiles(params)) {
  return JSON.stringify({
    ephemeris: [EPHEMERIS_MANIFEST.id, ephemerisFiles],
    ephemerisPolicy: params.ephemerisPolicy ?? 'prefer-spk',
    bodies: params.bodies.map((body) => [body.id, body.name, body.naifId, body.source, body.parentId, body.orbitRepresents, body.orbit]),
    resolution: params.resolutionBodies.map((body) => [body.id, body.name, body.naifId, body.source, body.parentId, body.orbitRepresents, body.orbit]),
    referenceId: params.referenceId,
    centerJulianDay: params.centerJulianDay,
    windowDays: params.windowDays,
    thresholdAU: params.thresholdAU,
    eventKinds: [...params.eventKinds].sort(),
    sampleCount: adaptiveEventSampleCount(eventSamplingBodies(params), params.windowDays, params.sampleCount),
  })
}

function cacheEventAnalysis(key: string, entry: CachedEventAnalysis) {
  const bytes = cacheWeight(key, entry)
  if (bytes > EVENT_CACHE_BYTE_LIMIT) return
  // Admission precedes the copy; cached nested objects must never alias UI state.
  // Caching is optional, so an uncloneable entry must not fail a valid result.
  let owned: CachedEventAnalysis
  try { owned = structuredClone(entry) } catch { return }
  deleteCachedAnalysis(key)
  while (eventAnalysisCache.size >= EVENT_CACHE_LIMIT || cachedBytes + bytes > EVENT_CACHE_BYTE_LIMIT) {
    const oldestKey = eventAnalysisCache.keys().next().value
    if (oldestKey === undefined) break
    deleteCachedAnalysis(oldestKey)
  }
  eventAnalysisCache.set(key, owned)
  cacheWeights.set(key, bytes)
  cachedBytes += bytes
}

export function useConjunctionWorker() {
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const [events, setEvents] = useState<AnalysisEvent[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<RunEventAnalysisParams | null>(null)
  const [ephemeris, setEphemeris] = useState<AnalysisEphemerisEvidence | null>(null)
  const [sampling, setSampling] = useState<EventSamplingReceipt | null>(null)

  const cancel = useCallback(() => {
    latestRequestId.current += 1
    const worker = workerRef.current
    if (!worker) return
    worker.terminate()
    workerRef.current = null
    setStatus('cancelled')
  }, [])

  const run = useCallback((params: RunEventAnalysisParams) => {
    const requestId = ++latestRequestId.current
    if (workerRef.current) workerRef.current.terminate()
    workerRef.current = null
    setProgress(0)
    setError(null)
    setEvents([])
    setEphemeris(null)
    setSampling(null)
    setLastRun(null)
    const fail = (error: unknown) => {
      if (requestId !== latestRequestId.current) return
      workerRef.current?.terminate()
      workerRef.current = null
      setProgress(0)
      setError(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
    let cacheKey: string
    let storedParams: RunEventAnalysisParams
    let request: EventAnalysisRequest
    try {
      admitEventAnalysis(params)
      storedParams = cloneParams(params)
      const ephemerisFiles = eventKernelFiles(storedParams)
      cacheKey = eventAnalysisCacheKey(storedParams, ephemerisFiles)
      // lastRun is exposed to consumers; keep the binding request independent.
      request = structuredClone({ ...storedParams, type: 'run' as const, requestId, ephemerisFiles })
      assertEventRequestBudget(request)
    }
    catch (error) { fail(error); return }
    const cached = eventAnalysisCache.get(cacheKey)
    if (cached) {
      try {
        assertEventResultBinding(request, { type: 'result', requestId, events: cached.events, ephemeris: cached.ephemeris ?? undefined, sampling: cached.sampling })
        const result = structuredClone(cached)
        eventAnalysisCache.delete(cacheKey)
        eventAnalysisCache.set(cacheKey, cached)
        setEvents(result.events)
        setEphemeris(result.ephemeris)
        setSampling(result.sampling)
        setLastRun(storedParams)
        setProgress(1)
        setError(null)
        setStatus('complete')
        return
      } catch {
        deleteCachedAnalysis(cacheKey)
      }
    }
    let worker: Worker
    try {
      worker = managedEphemerisWorker(new Worker(new URL('../workers/conjunction.worker.ts', import.meta.url), { type: 'module' }))
    }
    catch (error) { fail(error); return }
    workerRef.current = worker
    setStatus('running')
    setLastRun(storedParams)
    worker.onmessage = (event: MessageEvent<EventAnalysisResponse>) => {
      const response = event.data
      if (requestId !== latestRequestId.current || workerRef.current !== worker) return
      if (!response || response.requestId !== requestId) { fail(new Error('Invalid event worker response')); return }
      if (response.type === 'progress') {
        if (typeof response.progress !== 'number' || !Number.isFinite(response.progress) || response.progress < 0 || response.progress > 1) {
          fail(new Error('Invalid event worker progress')); return
        }
        setProgress(response.progress)
        return
      }
      if (response.type === 'result') {
        if (!Array.isArray(response.events) || response.events.length > MAX_ANALYSIS_EVENTS) { fail(new Error('Invalid event worker result')); return }
        try { assertEventResultBinding(request, response) }
        catch (error) { fail(error); return }
        const resultEvents = response.events
        setEvents(resultEvents)
        setEphemeris(response.ephemeris ?? null)
        setSampling(response.sampling ?? null)
        cacheEventAnalysis(cacheKey, { events: [...resultEvents], ephemeris: response.ephemeris ?? null, sampling: response.sampling! })
        setProgress(1)
        setStatus('complete')
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        return
      }
      if (response.type === 'cancelled') {
        setStatus('cancelled')
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        return
      }
      if (response.type === 'error') {
        fail(new Error(typeof response.error === 'string' ? response.error : 'Event analysis failed'))
        return
      }
      fail(new Error('Unknown event worker response'))
    }
    worker.onerror = (event) => {
      if (requestId !== latestRequestId.current || workerRef.current !== worker) return
      fail(new Error(event.message || 'Event worker failed'))
    }
    worker.onmessageerror = () => {
      if (requestId === latestRequestId.current && workerRef.current === worker) fail(new Error('Event worker message could not be decoded'))
    }
    try {
      worker.postMessage(request)
    }
    catch (error) { fail(error) }
  }, [])

  useEffect(() => () => {
    latestRequestId.current += 1
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  return { events, status, progress, error, lastRun, ephemeris, sampling, run, cancel }
}
