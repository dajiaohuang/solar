import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCurrentPositions } from '../lib/trajectory'
import { kernelFilesForBodies } from '../engine/ephemeris/kernelStore'
import { SEGMENTED_WEB } from '../lib/webExecution'
import { useEphemerisBusy, useEphemerisRevision } from './useEphemerides'
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
import { managedEphemerisWorker } from '../lib/managedEphemerisWorker'

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
  const workerKernelIdsRef = useRef<Set<string>>(new Set())
  const latestRequestId = useRef(0)
  const [trajectories, setTrajectories] = useState<TrajectorySample[]>([])
  const [trajectoryUnavailableBodyIds, setTrajectoryUnavailableBodyIds] = useState<BodyId[]>([])
  const [progress, setProgress] = useState(0)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backendEnabled = PRODUCT_PROFILE === 'full' && !SEGMENTED_WEB
  const ephemerisRevision = useEphemerisRevision()
  const ephemerisBusy = useEphemerisBusy()
  const bodiesById = useMemo(
    () => new Map<BodyId, CelestialBody>(resolutionBodies.map((body) => [body.id, body])),
    [resolutionBodies],
  )
  const trajectoryKernelIdsKey = useMemo(() => {
    if (backendEnabled || SEGMENTED_WEB) return '[]'
    const targets = [...trajectoryBodies]
    const referenceBody = bodiesById.get(referenceId) ?? bodies.find(body => body.id === referenceId)
    if (referenceBody && !targets.some(body => body.id === referenceId)) targets.push(referenceBody)
    return JSON.stringify(kernelFilesForBodies(targets))
  }, [backendEnabled, trajectoryBodies, bodies, bodiesById, referenceId])
  const trajectoryKernelIds = useMemo(() => JSON.parse(trajectoryKernelIdsKey) as string[], [trajectoryKernelIdsKey])
  const kernelKey = backendEnabled ? '' : trajectoryKernelIdsKey
  const ephemerisLoading = !backendEnabled && ephemerisBusy
  const requestKey = useMemo(() => backendEnabled ? '' : JSON.stringify([referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, trajectoryBodies, resolutionBodies]),
    [backendEnabled, referenceId, trajectoryJulianDay, historyDays, sampleCount, kernelKey, trajectoryBodies, resolutionBodies])
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(null)
  const configured = import.meta.env.VITE_SOLAR_API_BASE_URL
  const backend = useBackendTrajectoryWorker({ enabled: backendEnabled && currentFrame !== null,
    base: typeof configured === 'string' && configured.trim() ? configured.trim().replace(/\/+$/, '') : null,
    bodies: trajectoryBodies, referenceBody: bodiesById.get(referenceId), centerUtcJd: trajectoryJulianDay, historyDays, sampleCount,
    sourceKey: `${currentFrame?.catalogManifestSha256 ?? ''}:${currentFrame?.inventoryManifestSha256 ?? ''}`, seekRevision: params.seekRevision ?? 0,
    expectedCatalogManifestSha256: currentFrame?.catalogManifestSha256, expectedInventoryManifestSha256: currentFrame?.inventoryManifestSha256 })

  const localCurrent = useMemo(() => {
    void ephemerisRevision
    return !backendEnabled && currentFrame === undefined ? buildCurrentPositions({
      bodies,
      bodiesById,
      referenceId,
      julianDay: currentJulianDay,
      resolveBodyPosition,
    }) : { currentPositions: EMPTY_CURRENT_POSITIONS, missingBodyIds: bodies.map(body => body.id), maxDistance: 0, trajectoryUnavailableBodyIds: [] as BodyId[] }
  }, [backendEnabled, bodies, bodiesById, currentFrame, currentJulianDay, referenceId, resolveBodyPosition, ephemerisRevision])

  useEffect(() => {
    if (backendEnabled) return
    // A large preset may install hundreds of files. Current positions can
    // update progressively, but do not restart a full sampled trajectory for
    // every partial pool and repeatedly send all those kernels to the worker.
    if (ephemerisLoading) {
      // Free the previous worker's retained pool while the main thread admits
      // new files; keeping both pools can otherwise exhaust their shared cap.
      workerRef.current?.terminate()
      workerRef.current = null
      workerKernelIdsRef.current.clear()
      let active = true
      queueMicrotask(() => {
        if (!active) return
        setIsComputing(true)
        setProgress(0)
      })
      return () => { active = false }
    }
    // Preserve verified kernel buffers across clock updates; recreating a
    // worker every trail tick would repeatedly download/hash/parse megabytes.
    let active = true, settled = false
    let worker: Worker
    const requestedKernelIds = new Set(trajectoryKernelIds)
    // A persistent worker keeps parsed SPKs installed. Reuse is safe when its
    // retained source set is contained by this request; discard stale pools
    // when the selected body set moves to different source solutions.
    if (workerRef.current && [...workerKernelIdsRef.current].some(id => !requestedKernelIds.has(id))) {
      workerRef.current.terminate()
      workerRef.current = null
      workerKernelIdsRef.current.clear()
    }
    try { worker = workerRef.current ?? managedEphemerisWorker(new Worker(new URL('../workers/trajectory.worker.ts', import.meta.url), { type: 'module' })) }
    catch (reason) {
      queueMicrotask(() => {
        if (!active) return
        setTrajectories([]); setTrajectoryUnavailableBodyIds([])
        setProgress(0); setIsComputing(false); setError(String(reason))
      })
      return () => { active = false }
    }
    workerRef.current = worker
    for (const id of requestedKernelIds) workerKernelIdsRef.current.add(id)
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId
    queueMicrotask(() => {
      if (!active || settled || latestRequestId.current !== requestId) return
      setIsComputing(true)
      setProgress(0)
      setError(null)
      setTrajectories([])
      setTrajectoryUnavailableBodyIds([])
    })

    const fail = (message: string) => {
      if (!active || settled || requestId !== latestRequestId.current) return
      settled = true
      setTrajectories([]); setTrajectoryUnavailableBodyIds([])
      setProgress(0); setError(message); setIsComputing(false)
      worker.terminate()
      if (workerRef.current === worker) { workerRef.current = null; workerKernelIdsRef.current.clear() }
    }
    worker.onmessage = (event: MessageEvent<TrajectoryWorkerResponse>) => {
      const response = event.data
      if (!active || settled || !response || response.requestId !== requestId || requestId !== latestRequestId.current) return
      if (response.type === 'progress') {
        if (typeof response.progress !== 'number' || !Number.isFinite(response.progress) || response.progress < 0 || response.progress > 1) { fail('Invalid trajectory progress'); return }
        setProgress(response.progress)
      } else if (response.type === 'result' && response.packed) {
        let views: TrajectorySample[]
        try { views = trajectoryViews(response.packed, bodiesById) }
        catch (reason) { fail(reason instanceof Error ? reason.message : String(reason)); return }
        settled = true
        setTrajectories(views)
        setTrajectoryUnavailableBodyIds(response.packed.trajectoryUnavailableBodyIds ?? [])
        setCompletedRequestKey(requestKey)
        setProgress(1)
        setIsComputing(false)
      } else if (response.type === 'error') {
        fail(response.error ?? 'Trajectory worker failed')
      } else fail('Invalid trajectory worker response')
    }
    const workerFailed = (message: string) => {
      fail(message)
      // A worker that fails after delivering a valid result cannot be reused.
      if (workerRef.current === worker) { worker.terminate(); workerRef.current = null }
    }
    worker.onerror = event => workerFailed(event.message || 'Trajectory worker failed')
    worker.onmessageerror = () => workerFailed('Trajectory worker response could not be decoded')

    const request: TrajectoryWorkerRequest = {
      type: 'compute',
      ephemerisFiles: trajectoryKernelIds,
      requestId,
      bodies: trajectoryBodies,
      resolutionBodies,
      referenceId,
      centerJulianDay: trajectoryJulianDay,
      historyDays,
      sampleCount,
    }
    try { worker.postMessage(request) }
    catch (reason) { fail(reason instanceof Error ? reason.message : String(reason)) }

    return () => {
      active = false
      if (workerRef.current === worker) {
        try { worker.postMessage({ type: 'cancel', requestId }) }
        catch { worker.terminate(); workerRef.current = null }
      }
    }
  }, [backendEnabled, trajectoryBodies, trajectoryKernelIds, bodiesById, ephemerisLoading, historyDays, referenceId, requestKey, resolutionBodies, sampleCount, trajectoryJulianDay])

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
    workerKernelIdsRef.current.clear()
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
