import { useEffect, useRef, useState } from 'react'
import { createCatalogPointWorkerScheduler, type CatalogPointResult } from '../lib/catalogPointWorkerScheduler'
import { CATALOG_ELEMENT_STRIDE, type CatalogPointMode } from '../engine/ephemeris/catalogPoints'
import type { AsteroidRecord } from '../types'

const EMPTY_POSITIONS = new Float32Array()

export function useCatalogPointWorker(records: AsteroidRecord[], julianDay: number, mode: CatalogPointMode) {
  const schedulerRef = useRef<ReturnType<typeof createCatalogPointWorkerScheduler> | null>(null)
  const julianDayRef = useRef(julianDay)
  const [computed, setComputed] = useState<(CatalogPointResult & { records: AsteroidRecord[] }) | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { julianDayRef.current = julianDay }, [julianDay])

  useEffect(() => {
    // A mode/dataset switch releases the old worker and its source elements.
    // Never let a late old-dimension response install a second full buffer.
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setComputed(null)
      setProgress(0)
      setError(null)
    })
    if (!records.length) return () => { active = false }
    const worker = new Worker(new URL('../workers/catalog-points.worker.ts', import.meta.url), { type: 'module' })
    const scheduler = createCatalogPointWorkerScheduler((request, transfer) => worker.postMessage(request, transfer ?? []), {
      onProgress: (value) => setProgress(value),
      onResult: (result) => {
        setComputed({ ...result, records })
        setProgress(1)
      },
      onError: (message) => { setComputed(null); setError(message) },
    }, mode)
    schedulerRef.current = scheduler
    worker.onmessage = (event: MessageEvent) => { if (active) scheduler.handle(event.data) }
    worker.onerror = (event) => {
      if (!active) return
      scheduler.reset(false)
      setComputed(null)
      setError(event.message || 'Catalog point propagation failed')
    }
    const elements = new Float64Array(records.length * CATALOG_ELEMENT_STRIDE)
    for (let index = 0; index < records.length; index++) {
      const record = records[index], offset = index * CATALOG_ELEMENT_STRIDE
      elements[offset] = record.epochJd
      elements[offset + 1] = record.semiMajorAxisAU
      elements[offset + 2] = record.eccentricity
      elements[offset + 3] = record.inclinationDeg
      elements[offset + 4] = record.ascendingNodeDeg
      elements[offset + 5] = record.argPeriapsisDeg
      elements[offset + 6] = record.meanAnomalyDeg
      elements[offset + 7] = record.meanMotionDegPerDay
    }
    scheduler.setElements(elements)
    scheduler.requestJulianDay(julianDayRef.current)
    return () => {
      active = false
      scheduler.reset(false)
      if (schedulerRef.current === scheduler) schedulerRef.current = null
      worker.terminate()
    }
  }, [mode, records])

  useEffect(() => { schedulerRef.current?.requestJulianDay(julianDay) }, [julianDay])

  const current = computed?.records === records && computed.mode === mode ? computed : null
  return {
    positions: current?.positions ?? EMPTY_POSITIONS,
    computedJulianDay: current?.julianDay ?? julianDay,
    readyCount: current ? Math.min(records.length, current.positions.length / (mode === '2d' ? 2 : 3)) : 0,
    progress,
    error,
  }
}
