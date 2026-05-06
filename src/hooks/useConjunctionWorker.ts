import { useEffect, useRef, useState } from 'react'
import type { CelestialBody } from '../types'
import type { ConjunctionEvent, ConjunctionRequest, ConjunctionResponse } from '../workers/conjunction.worker'

type Params = {
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: string
  centerJulianDay: number
  windowDays: number
  thresholdAU: number
}

export function useConjunctionWorker(params: Params) {
  const { bodies, resolutionBodies, referenceId, centerJulianDay, windowDays, thresholdAU } = params
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const [events, setEvents] = useState<ConjunctionEvent[]>([])
  const [isComputing, setIsComputing] = useState(false)

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/conjunction.worker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (event: MessageEvent<ConjunctionResponse>) => {
      const response = event.data

      if (response.type !== 'result' || response.requestId !== latestRequestId.current) {
        return
      }

      setEvents(response.events)
      setIsComputing(false)
    }

    workerRef.current = worker

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker || bodies.length < 2) {
      return
    }

    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    setIsComputing(true)

    const request: ConjunctionRequest = {
      type: 'find',
      requestId,
      bodies,
      resolutionBodies,
      referenceId,
      centerJulianDay,
      windowDays,
      thresholdAU,
    }

    worker.postMessage(request)
  }, [bodies, centerJulianDay, referenceId, resolutionBodies, windowDays, thresholdAU])

  return { events, isComputing }
}
