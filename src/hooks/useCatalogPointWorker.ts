import { useCallback, useEffect, useRef, useState } from 'react'
import { createCatalogPointWorkerScheduler, type CatalogPointResult } from '../lib/catalogPointWorkerScheduler'
import { CATALOG_ELEMENT_STRIDE, type CatalogPointMode } from '../engine/ephemeris/catalogPoints'
import type { AsteroidRecord } from '../types'
import { catalogTemporalDisplacementAU } from '../engine/ephemeris/catalogTemporalBudget'

const EMPTY_POSITIONS = new Float64Array()

export function useCatalogPointWorker(records: AsteroidRecord[], julianDay: number, mode: CatalogPointMode, maximumTemporalDriftAU = 0) {
  const schedulerRef = useRef<ReturnType<typeof createCatalogPointWorkerScheduler> | null>(null)
  const julianDayRef = useRef(julianDay)
  const temporalBudgetRef = useRef(maximumTemporalDriftAU)
  const [computed, setComputed] = useState<(CatalogPointResult & { records: AsteroidRecord[] }) | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const retry = useCallback(() => setRetryGeneration(value => value + 1), [])

  useEffect(() => { julianDayRef.current = julianDay }, [julianDay])
  useEffect(() => { temporalBudgetRef.current = maximumTemporalDriftAU; schedulerRef.current?.setTemporalBudget(maximumTemporalDriftAU) }, [maximumTemporalDriftAU])

  useEffect(() => {
    // A mode/dataset switch releases the old worker and its source elements.
    // Never let a late old-dimension response install a second full buffer.
    let active = true, failed = false
    queueMicrotask(() => {
      if (!active || failed) return
      setComputed(null)
      setProgress(0)
      setError(null)
    })
    if (!records.length) return () => { active = false }
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/catalog-points.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      failed = true
      const message = error instanceof Error ? error.message : String(error)
      // No instance exists to release. Keep this failure inside the catalog
      // pane rather than throwing out of the React effect and its workspace.
      queueMicrotask(() => {
        if (!active) return
        setComputed(null); setProgress(0)
        setError(`Unable to create catalog point worker: ${message}`)
      })
      return () => { active = false }
    }
    const scheduler = createCatalogPointWorkerScheduler((request, transfer) => worker.postMessage(request, transfer ?? []), {
      onProgress: (value) => setProgress(value),
      onResult: (result) => {
        setComputed({ ...result, records })
        setProgress(1)
        setError(null)
      },
      onError: (message) => fail(message),
    }, mode)
    const release = () => {
      scheduler.reset(false)
      if (schedulerRef.current === scheduler) schedulerRef.current = null
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
      worker.terminate()
    }
    const fail = (message: string) => {
      if (!active || failed) return
      failed = true
      release()
      setComputed(null)
      setProgress(0)
      setError(message)
    }
    schedulerRef.current = scheduler
    worker.onmessage = (event: MessageEvent) => {
      if (!active || failed) return
      try { scheduler.handle(event.data) }
      catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    }
    worker.onerror = (event) => fail(event.message || 'Catalog point propagation failed')
    worker.onmessageerror = () => fail('Catalog point worker response could not be decoded')
    try {
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
      if (!failed) {
        scheduler.setTemporalBudget(temporalBudgetRef.current)
        scheduler.requestJulianDay(julianDayRef.current)
      }
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    return () => {
      active = false
      release()
    }
  }, [mode, records, retryGeneration])

  useEffect(() => { schedulerRef.current?.requestJulianDay(julianDay) }, [julianDay])

  const current = computed?.records === records && computed.mode === mode ? computed : null
  return {
    positions: current?.positions ?? EMPTY_POSITIONS,
    computedJulianDay: current?.julianDay ?? julianDay,
    readyCount: current ? Math.min(records.length, current.positions.length / (mode === '2d' ? 2 : 3)) : 0,
    progress,
    error,
    retry,
    temporalDriftAU: current ? catalogTemporalDisplacementAU(current.julianDay, julianDay, current.maximumSpeedAUPerTtDay ?? null) : null,
  }
}
