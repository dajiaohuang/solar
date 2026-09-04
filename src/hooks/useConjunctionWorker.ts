import { useCallback, useEffect, useRef, useState } from 'react'
import type { CelestialBody } from '../types'
import { loadedKernelIds, EPHEMERIS_MANIFEST } from '../engine/ephemeris/kernelStore'
import { adaptiveEventSampleCount } from '../engine/events/eventSampling'
import type {
  AnalysisEvent,
  EventAnalysisRequest,
  EventAnalysisResponse,
  EventKind,
} from '../workers/conjunction.worker'

export type RunEventAnalysisParams = {
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: string
  centerJulianDay: number
  windowDays: number
  thresholdAU: number
  eventKinds: EventKind[]
  sampleCount?: number
}

type CachedEventAnalysis = {
  events: AnalysisEvent[]
  params: RunEventAnalysisParams
}

const EVENT_CACHE_LIMIT = 8
const eventAnalysisCache = new Map<string, CachedEventAnalysis>()

function cloneParams(params: RunEventAnalysisParams): RunEventAnalysisParams {
  return {
    ...params,
    bodies: [...params.bodies],
    resolutionBodies: [...params.resolutionBodies],
    eventKinds: [...params.eventKinds],
  }
}

export function eventAnalysisCacheKey(params: RunEventAnalysisParams) {
  return JSON.stringify({
    ephemeris: [EPHEMERIS_MANIFEST.id, loadedKernelIds()],
    bodies: params.bodies.map((body) => [body.id, body.parentId, body.orbit]),
    resolution: params.resolutionBodies.map((body) => [body.id, body.parentId, body.orbit]),
    referenceId: params.referenceId,
    centerJulianDay: params.centerJulianDay,
    windowDays: params.windowDays,
    thresholdAU: params.thresholdAU,
    eventKinds: [...params.eventKinds].sort(),
    sampleCount: adaptiveEventSampleCount(params.bodies, params.windowDays, params.sampleCount),
  })
}

function cacheEventAnalysis(key: string, entry: CachedEventAnalysis) {
  eventAnalysisCache.delete(key)
  eventAnalysisCache.set(key, entry)
  while (eventAnalysisCache.size > EVENT_CACHE_LIMIT) {
    const oldestKey = eventAnalysisCache.keys().next().value
    if (oldestKey === undefined) break
    eventAnalysisCache.delete(oldestKey)
  }
}

export function useConjunctionWorker() {
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const activeCacheKey = useRef('')
  const [events, setEvents] = useState<AnalysisEvent[]>([])
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<RunEventAnalysisParams | null>(null)

  const cancel = useCallback(() => {
    const worker = workerRef.current
    if (!worker) return
    worker.postMessage({ type: 'cancel', requestId: latestRequestId.current })
    worker.terminate()
    workerRef.current = null
    setStatus('cancelled')
  }, [])

  const run = useCallback((params: RunEventAnalysisParams) => {
    if (workerRef.current) workerRef.current.terminate()
    workerRef.current = null
    const cacheKey = eventAnalysisCacheKey(params)
    const cached = eventAnalysisCache.get(cacheKey)
    if (cached) {
      eventAnalysisCache.delete(cacheKey)
      eventAnalysisCache.set(cacheKey, cached)
      setEvents([...cached.events])
      setLastRun(cloneParams(cached.params))
      setProgress(1)
      setError(null)
      setStatus('complete')
      return
    }
    const worker = new Worker(new URL('../workers/conjunction.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    activeCacheKey.current = cacheKey
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    setStatus('running')
    setProgress(0)
    setError(null)
    setEvents([])
    const storedParams = cloneParams(params)
    setLastRun(storedParams)
    worker.onmessage = (event: MessageEvent<EventAnalysisResponse>) => {
      const response = event.data
      if (response.requestId !== latestRequestId.current) return
      if (response.type === 'progress') setProgress(response.progress ?? 0)
      if (response.type === 'result') {
        const resultEvents = response.events ?? []
        setEvents(resultEvents)
        cacheEventAnalysis(activeCacheKey.current, { events: [...resultEvents], params: storedParams })
        setProgress(1)
        setStatus('complete')
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
      if (response.type === 'cancelled') {
        setStatus('cancelled')
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
      if (response.type === 'error') {
        setError(response.error ?? 'Event analysis failed')
        setStatus('error')
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
    }
    worker.onerror = (event) => {
      if (requestId !== latestRequestId.current) return
      setError(event.message || 'Event worker failed')
      setStatus('error')
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    const request: EventAnalysisRequest = { type: 'run', requestId, ...params, ephemerisFiles: loadedKernelIds() }
    worker.postMessage(request)
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { events, status, progress, error, lastRun, run, cancel }
}
