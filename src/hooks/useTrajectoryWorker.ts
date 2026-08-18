import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCurrentPositions } from '../lib/trajectory'
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
  const [progress, setProgress] = useState(0)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    const previousWorker = workerRef.current
    if (previousWorker) previousWorker.terminate()
    const worker = new Worker(new URL('../workers/trajectory.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    queueMicrotask(() => {
      if (latestRequestId.current !== requestId) return
      setIsComputing(true)
      setProgress(0)
      setError(null)
    })

    worker.onmessage = (event: MessageEvent<TrajectoryWorkerResponse>) => {
      const response = event.data
      if (response.requestId !== latestRequestId.current) return
      if (response.type === 'progress') {
        setProgress(response.progress ?? 0)
      } else if (response.type === 'result' && response.packed) {
        setTrajectories(unpackTrajectories(response.packed, bodiesById))
        setProgress(1)
        setIsComputing(false)
      } else if (response.type === 'error') {
        setError(response.error ?? 'Trajectory worker failed')
        setIsComputing(false)
      }
    }

    const request: TrajectoryWorkerRequest = {
      type: 'compute',
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
      worker.postMessage({ type: 'cancel', requestId })
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [bodies, bodiesById, historyDays, referenceId, resolutionBodies, sampleCount, trajectoryJulianDay])

  const frame = useMemo(() => ({ ...current, trajectories }), [current, trajectories])

  return {
    frame,
    progress,
    isComputing,
    error,
  }
}
