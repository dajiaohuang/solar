import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCurrentPositions } from '../lib/trajectory'
import { getEphemerisSnapshot, loadedKernelIds } from '../engine/ephemeris/kernelStore'
import type {
  BodyId,
  CelestialBody,
  TrajectorySample,
  TrajectoryWorkerRequest,
  TrajectoryWorkerResponse,
  Vector3,
} from '../types'
import type { BackendFrame } from '../lib/backendFrames'
import { EMPTY_CURRENT_POSITIONS } from '../lib/currentPositions'
import { trajectoryViews } from '../lib/trajectorySamples'
import { PRODUCT_PROFILE } from '../lib/productAvailability'
import { useBackendTrajectoryWorker } from './useBackendTrajectoryWorker'

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
  seekRevision?: number
  currentFrame?: BackendFrame | null
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
  const backendEnabled = PRODUCT_PROFILE === 'full'
  const kernelKey = backendEnabled ? '' : loadedKernelIds().join('|')
  const ephemerisLoading = !backendEnabled && getEphemerisSnapshot().loading > 0
  const requestKey = useMemo(() => backendEnabled ? '' : JSON.stringify([referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, trajectoryBodies, resolutionBodies]),
    [backendEnabled, referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, trajectoryBodies, resolutionBodies])
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(null)
  const bodiesById = useMemo(
    () => new Map<BodyId, CelestialBody>(resolutionBodies.map((body) => [body.id, body])),
    [resolutionBodies],
  )
  const configured = import.meta.env.VITE_SOLAR_API_BASE_URL
  const backend = useBackendTrajectoryWorker({ enabled: backendEnabled && currentFrame !== null,
    base: typeof configured === 'string' && configured.trim() ? configured.trim().replace(/\/+$/, '') : null,
    bodies: trajectoryBodies, referenceBody: bodiesById.get(referenceId), centerUtcJd: trajectoryJulianDay, historyDays, sampleCount,
    sourceKey: `${currentFrame?.catalogManifestSha256 ?? ''}:${currentFrame?.inventoryManifestSha256 ?? ''}`, seekRevision: params.seekRevision ?? 0,
    expectedCatalogManifestSha256: currentFrame?.catalogManifestSha256, expectedInventoryManifestSha256: currentFrame?.inventoryManifestSha256 })

  const localCurrent = useMemo(() => !backendEnabled && currentFrame === undefined ? buildCurrentPositions({
    bodies,
    bodiesById,
    referenceId,
    julianDay: currentJulianDay,
    resolveBodyPosition,
  }) : { currentPositions: EMPTY_CURRENT_POSITIONS, missingBodyIds: bodies.map(body => body.id), maxDistance: 0, trajectoryUnavailableBodyIds: [] as BodyId[] },
  [backendEnabled, bodies, bodiesById, currentFrame, currentJulianDay, referenceId, resolveBodyPosition])

  useEffect(() => {
    if (backendEnabled) return
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
        setTrajectories(trajectoryViews(response.packed, bodiesById))
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
  }, [backendEnabled, trajectoryBodies, bodiesById, ephemerisLoading, historyDays, referenceId, requestKey, resolutionBodies, sampleCount, trajectoryJulianDay])

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  const frame = useMemo(() => ({
    ...(currentFrame !== undefined
      ? (currentFrame ? { ...currentFrame, trajectoryUnavailableBodyIds: [] as BodyId[] } : { currentPositions: EMPTY_CURRENT_POSITIONS, missingBodyIds: bodies.map(body => body.id), maxDistance: 0, trajectoryUnavailableBodyIds: [] as BodyId[] })
      : localCurrent),
    trajectories: backendEnabled ? backend.trajectories : completedRequestKey === requestKey
      ? trajectories.filter(sample => !(currentFrame ? currentFrame.missingBodyIds : localCurrent.missingBodyIds).includes(sample.body.id))
      : [],
    trajectoryUnavailableBodyIds: backendEnabled ? backend.unavailableBodyIds : completedRequestKey === requestKey ? trajectoryUnavailableBodyIds : [],
    trajectoryAudit: backendEnabled ? backend.audit : undefined,
  }), [backendEnabled, backend.audit, backend.trajectories, backend.unavailableBodyIds, bodies, completedRequestKey, currentFrame, localCurrent, requestKey, trajectories, trajectoryUnavailableBodyIds])

  return {
    frame,
    progress: backendEnabled ? backend.progress : progress,
    isComputing: backendEnabled ? backend.isComputing : isComputing,
    error: backendEnabled ? backend.error : error,
  }
}
