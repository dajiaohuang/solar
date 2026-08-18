import { useEffect, useRef, useState } from 'react'
import type { AsteroidRecord, CatalogPointWorkerRequest, CatalogPointWorkerResponse } from '../types'

export function useCatalogPointWorker(records: AsteroidRecord[], julianDay: number) {
  const requestId = useRef(0)
  const [positions, setPositions] = useState<Float32Array>(new Float32Array())
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const currentRequestId = requestId.current + 1
    requestId.current = currentRequestId
    if (!records.length) {
      queueMicrotask(() => {
        if (requestId.current !== currentRequestId) return
        setPositions(new Float32Array())
        setProgress(0)
      })
      return
    }
    const worker = new Worker(new URL('../workers/catalog-points.worker.ts', import.meta.url), { type: 'module' })
    queueMicrotask(() => {
      if (requestId.current !== currentRequestId) return
      setProgress(0)
      setError(null)
    })
    const elements = new Float64Array(records.length * 8)
    records.forEach((record, index) => elements.set([
      record.epochJd, record.semiMajorAxisAU, record.eccentricity, record.inclinationDeg,
      record.ascendingNodeDeg, record.argPeriapsisDeg, record.meanAnomalyDeg, record.meanMotionDegPerDay,
    ], index * 8))
    worker.onmessage = (event: MessageEvent<CatalogPointWorkerResponse>) => {
      if (event.data.requestId !== requestId.current) return
      if (event.data.type === 'progress') setProgress(event.data.progress ?? 0)
      if (event.data.type === 'result') {
        setPositions(event.data.positions ?? new Float32Array())
        setProgress(1)
        worker.terminate()
      }
      if (event.data.type === 'error') {
        setError(event.data.error ?? 'Catalog point propagation failed')
        worker.terminate()
      }
    }
    const request: CatalogPointWorkerRequest = {
      type: 'compute', requestId: currentRequestId, julianDay, elements,
    }
    worker.postMessage(request, [elements.buffer])
    return () => worker.terminate()
  }, [julianDay, records])

  return { positions, progress, error }
}
