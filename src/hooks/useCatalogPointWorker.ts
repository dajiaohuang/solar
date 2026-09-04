import { useEffect, useRef, useState } from 'react'
import { createCatalogPointWorkerScheduler } from '../lib/catalogPointWorkerScheduler'
import type { AsteroidRecord } from '../types'

const EMPTY_POSITIONS = new Float32Array()

export function useCatalogPointWorker(records: AsteroidRecord[], julianDay: number) {
  const schedulerRef = useRef<ReturnType<typeof createCatalogPointWorkerScheduler> | null>(null)
  const recordsRef = useRef(records)
  const julianDayRef = useRef(julianDay)
  const [positions, setPositions] = useState<Float32Array>(EMPTY_POSITIONS)
  const [positions3D, setPositions3D] = useState<Float32Array>(EMPTY_POSITIONS)
  const [computedRecords, setComputedRecords] = useState(records)
  const [computedJulianDay, setComputedJulianDay] = useState(julianDay)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { julianDayRef.current = julianDay }, [julianDay])

  useEffect(() => {
    const worker = new Worker(new URL('../workers/catalog-points.worker.ts', import.meta.url), { type: 'module' })
    const scheduler = createCatalogPointWorkerScheduler((request, transfer) => worker.postMessage(request, transfer ?? []), {
      onProgress: (value) => setProgress(value),
      onResult: (result) => {
        const activeRecords = recordsRef.current
        setPositions(result.positions)
        setPositions3D(result.positions3D)
        setComputedRecords(activeRecords)
        setComputedJulianDay(result.julianDay)
        setProgress(1)
      },
      onError: (message) => setError(message),
    })
    schedulerRef.current = scheduler
    worker.onmessage = (event: MessageEvent) => scheduler.handle(event.data)
    worker.onerror = (event) => {
      scheduler.reset(false)
      setError(event.message || 'Catalog point propagation failed')
    }
    return () => {
      scheduler.reset()
      schedulerRef.current = null
      worker.terminate()
    }
  }, [])

  useEffect(() => {
    recordsRef.current = records
    if (!records.length) {
      schedulerRef.current?.reset()
      queueMicrotask(() => {
        if (recordsRef.current !== records) return
        setPositions(EMPTY_POSITIONS)
        setPositions3D(EMPTY_POSITIONS)
        setComputedRecords(records)
        setComputedJulianDay(julianDayRef.current)
        setProgress(0)
        setError(null)
      })
      return
    }
    queueMicrotask(() => {
      if (recordsRef.current !== records) return
      setPositions(EMPTY_POSITIONS)
      setPositions3D(EMPTY_POSITIONS)
      setComputedRecords([])
      setProgress(0)
      setError(null)
    })
    const elements = new Float64Array(records.length * 8)
    records.forEach((record, index) => elements.set([
      record.epochJd, record.semiMajorAxisAU, record.eccentricity, record.inclinationDeg,
      record.ascendingNodeDeg, record.argPeriapsisDeg, record.meanAnomalyDeg, record.meanMotionDegPerDay,
    ], index * 8))
    schedulerRef.current?.setElements(elements)
    schedulerRef.current?.requestJulianDay(julianDayRef.current)
  }, [records])

  useEffect(() => { schedulerRef.current?.requestJulianDay(julianDay) }, [julianDay])

  const ready = computedRecords === records
  return {
    positions: ready ? positions : EMPTY_POSITIONS,
    positions3D: ready ? positions3D : EMPTY_POSITIONS,
    computedJulianDay,
    readyCount: ready ? Math.min(records.length, Math.floor(positions.length / 2), Math.floor(positions3D.length / 3)) : 0,
    progress,
    error,
  }
}
