import { useCallback, useEffect, useRef, useState } from 'react'
import type { CelestialBody } from '../types'
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

export function useConjunctionWorker() {
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
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
    const worker = new Worker(new URL('../workers/conjunction.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    setStatus('running')
    setProgress(0)
    setError(null)
    setEvents([])
    setLastRun({ ...params, bodies: [...params.bodies], resolutionBodies: [...params.resolutionBodies], eventKinds: [...params.eventKinds] })
    worker.onmessage = (event: MessageEvent<EventAnalysisResponse>) => {
      const response = event.data
      if (response.requestId !== latestRequestId.current) return
      if (response.type === 'progress') setProgress(response.progress ?? 0)
      if (response.type === 'result') {
        setEvents(response.events ?? [])
        setProgress(1)
        setStatus('complete')
      }
      if (response.type === 'cancelled') setStatus('cancelled')
      if (response.type === 'error') {
        setError(response.error ?? 'Event analysis failed')
        setStatus('error')
      }
    }
    const request: EventAnalysisRequest = { type: 'run', requestId, ...params }
    worker.postMessage(request)
  }, [])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { events, status, progress, error, lastRun, run, cancel }
}
