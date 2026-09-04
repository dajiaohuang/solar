import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCurrentPositions } from '../lib/trajectory'
import { loadedKernelIds } from '../engine/ephemeris/kernelStore'
import type {
  BodyId,
  CelestialBody,
  PackedTrajectoryData,
  TrajectorySample,
  TrajectoryWorkerRequest,
  TrajectoryWorkerResponse,
} from '../types'

type Params = {
  bodies: CelestialBody[]
  resolutionBodies: CelestialBody[]
  referenceId: BodyId
  currentJulianDay: number
  trajectoryJulianDay: number
  historyDays: number
  sampleCount: number
}

function unpackTrajectories(packed: PackedTrajectoryData, bodiesById: Map<BodyId, CelestialBody>) {
  const trajectories: TrajectorySample[] = []
  for (let index = 0; index < packed.bodyIds.length; index += 1) {
    const body = bodiesById.get(packed.bodyIds[index])
    if (!body) continue
    const start = packed.offsets[index]
    const end = packed.offsets[index + 1]
    const points = []
    const points3D = []
    for (let cursor = start; cursor < end; cursor += 1) {
      points.push({ x: packed.points2D[cursor * 2], y: packed.points2D[cursor * 2 + 1] })
      points3D.push({
        x: packed.points3D[cursor * 3],
        y: packed.points3D[cursor * 3 + 1],
        z: packed.points3D[cursor * 3 + 2],
      })
    }
    trajectories.push({ body, points, points3D })
  }
  return trajectories
}

export function useTrajectoryWorker(params: Params) {
  const {
    bodies,
    resolutionBodies,
    referenceId,
    currentJulianDay,
    trajectoryJulianDay,
    historyDays,
    sampleCount,
  } = params
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const [trajectories, setTrajectories] = useState<TrajectorySample[]>([])
  const [trajectoryUnavailableBodyIds, setTrajectoryUnavailableBodyIds] = useState<BodyId[]>([])
  const [progress, setProgress] = useState(0)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kernelKey = loadedKernelIds().join('|')
  const requestKey = useMemo(() => JSON.stringify([referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, bodies, resolutionBodies]),
    [referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, bodies, resolutionBodies])
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(null)
  const bodiesById = useMemo(
    () => new Map<BodyId, CelestialBody>(resolutionBodies.map((body) => [body.id, body])),
    [resolutionBodies],
  )

  const current = useMemo(() => buildCurrentPositions({
    bodies,
    bodiesById,
    referenceId,
    julianDay: currentJulianDay,
  }), [bodies, bodiesById, currentJulianDay, referenceId])

  useEffect(() => {
    // Preserve verified kernel buffers across clock updates; recreating a
    // worker every trail tick would repeatedly download/hash/parse megabytes.
    const worker = workerRef.current ?? new Worker(new URL('../workers/trajectory.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    queueMicrotask(() => {
      if (latestRequestId.current !== requestId) return
      setIsComputing(true)
      setProgress(0)
      setError(null)
      setTrajectories([])
      setTrajectoryUnavailableBodyIds([])
    })

    worker.onmessage = (event: MessageEvent<TrajectoryWorkerResponse>) => {
      const response = event.data
      if (response.requestId !== latestRequestId.current) return
      if (response.type === 'progress') {
        setProgress(response.progress ?? 0)
      } else if (response.type === 'result' && response.packed) {
        setTrajectories(unpackTrajectories(response.packed, bodiesById))
        setTrajectoryUnavailableBodyIds(response.packed.trajectoryUnavailableBodyIds ?? [])
        setCompletedRequestKey(requestKey)
        setProgress(1)
        setIsComputing(false)
      } else if (response.type === 'error') {
        setTrajectories([])
        setError(response.error ?? 'Trajectory worker failed')
        setIsComputing(false)
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
    }
    worker.onerror = (event) => {
      if (requestId !== latestRequestId.current) return
      setTrajectories([])
      setError(event.message || 'Trajectory worker failed')
      setIsComputing(false)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }

    const request: TrajectoryWorkerRequest = {
      type: 'compute',
      ephemerisFiles: loadedKernelIds(),
      requestId,
      bodies,
      resolutionBodies,
      referenceId,
      centerJulianDay: trajectoryJulianDay,
      historyDays,
      sampleCount,
    }
    worker.postMessage(request)

    return () => {
      if (workerRef.current === worker) {
        worker.postMessage({ type: 'cancel', requestId })
      }
    }
  }, [bodies, bodiesById, historyDays, referenceId, requestKey, resolutionBodies, sampleCount, trajectoryJulianDay])

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  const frame = useMemo(() => ({
    ...current,
    trajectories: completedRequestKey === requestKey
      ? trajectories.filter(sample => !current.missingBodyIds.includes(sample.body.id))
      : [],
    trajectoryUnavailableBodyIds: completedRequestKey === requestKey ? trajectoryUnavailableBodyIds : [],
  }), [completedRequestKey, current, requestKey, trajectories, trajectoryUnavailableBodyIds])

  return {
    frame,
    progress,
    isComputing,
    error,
  }
}
