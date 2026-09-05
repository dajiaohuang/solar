import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCurrentPositions } from '../lib/trajectory'
import { getEphemerisSnapshot, loadedKernelIds } from '../engine/ephemeris/kernelStore'
import type {
  BodyId,
  CelestialBody,
  PackedTrajectoryData,
  TrajectorySample,
  TrajectoryWorkerRequest,
  TrajectoryWorkerResponse,
  Vector3,
} from '../types'
import type { BackendFrame } from '../lib/backendFrames'
import { EMPTY_CURRENT_POSITIONS } from '../lib/currentPositions'

type Params = {
  bodies: CelestialBody[]
  trajectoryBodies?: CelestialBody[]
  resolveBodyPosition?: (id: BodyId) => Vector3
  resolutionBodies: CelestialBody[]
  referenceId: BodyId
  currentJulianDay: number
  trajectoryJulianDay: number
  historyDays: number
  sampleCount: number
  currentFrame?: Pick<BackendFrame, 'currentPositions' | 'missingBodyIds' | 'maxDistance'> | null
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
    trajectoryBodies = bodies,
    resolveBodyPosition,
    resolutionBodies,
    referenceId,
    currentJulianDay,
    trajectoryJulianDay,
    historyDays,
    sampleCount,
    currentFrame,
  } = params
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const [trajectories, setTrajectories] = useState<TrajectorySample[]>([])
  const [trajectoryUnavailableBodyIds, setTrajectoryUnavailableBodyIds] = useState<BodyId[]>([])
  const [progress, setProgress] = useState(0)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kernelKey = loadedKernelIds().join('|')
  const ephemerisLoading = getEphemerisSnapshot().loading > 0
  const requestKey = useMemo(() => JSON.stringify([referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, trajectoryBodies, resolutionBodies]),
    [referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, trajectoryBodies, resolutionBodies])
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(null)
  const bodiesById = useMemo(
    () => new Map<BodyId, CelestialBody>(resolutionBodies.map((body) => [body.id, body])),
    [resolutionBodies],
  )

  const localCurrent = useMemo(() => currentFrame === undefined ? buildCurrentPositions({
    bodies,
    bodiesById,
    referenceId,
    julianDay: currentJulianDay,
    resolveBodyPosition,
  }) : { currentPositions: EMPTY_CURRENT_POSITIONS, missingBodyIds: bodies.map(body => body.id), maxDistance: 0, trajectoryUnavailableBodyIds: [] as BodyId[] },
  [bodies, bodiesById, currentFrame, currentJulianDay, referenceId, resolveBodyPosition])

  useEffect(() => {
    // A large preset may install hundreds of files. Current positions can
    // update progressively, but do not restart a full sampled trajectory for
    // every partial pool and repeatedly send all those kernels to the worker.
    if (ephemerisLoading) {
      queueMicrotask(() => {
        setIsComputing(true)
        setProgress(0)
      })
      return
    }
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
      bodies: trajectoryBodies,
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
  }, [trajectoryBodies, bodiesById, ephemerisLoading, historyDays, referenceId, requestKey, resolutionBodies, sampleCount, trajectoryJulianDay])

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  const frame = useMemo(() => ({
    ...(currentFrame !== undefined
      ? (currentFrame ? { ...currentFrame, trajectoryUnavailableBodyIds: [] as BodyId[] } : { currentPositions: EMPTY_CURRENT_POSITIONS, missingBodyIds: bodies.map(body => body.id), maxDistance: 0, trajectoryUnavailableBodyIds: [] as BodyId[] })
      : localCurrent),
    trajectories: completedRequestKey === requestKey
      ? trajectories.filter(sample => !(currentFrame ? currentFrame.missingBodyIds : localCurrent.missingBodyIds).includes(sample.body.id))
      : [],
    trajectoryUnavailableBodyIds: completedRequestKey === requestKey ? trajectoryUnavailableBodyIds : [],
  }), [bodies, completedRequestKey, currentFrame, localCurrent, requestKey, trajectories, trajectoryUnavailableBodyIds])

  return {
    frame,
    progress,
    isComputing,
    error,
  }
}
