import { useEffect, useRef, useState } from 'react'
import type { BackendTrajectoryJob } from '../lib/backendTrajectoryQueue'
import type { BackendTrajectoryAudit } from '../lib/backendTrajectories'
import { trajectoryViews } from '../lib/trajectorySamples'
import type { BackendTrajectoryWorkerRequest, BackendTrajectoryWorkerResponse } from '../workers/backend-trajectories.protocol'
import type { CelestialBody, TrajectorySample } from '../types'
import { attachStateTileAdmission } from '../lib/stateTileAdmission'

type Params = Omit<BackendTrajectoryJob, 'requestId' | 'base' | 'referenceBody'> & { enabled: boolean; base: string | null; referenceBody?: CelestialBody; sourceKey: string; seekRevision: number }
const empty = { trajectories: [] as TrajectorySample[], unavailableBodyIds: [] as string[], audit: undefined as BackendTrajectoryAudit | undefined }

export function useBackendTrajectoryWorker(params: Params) {
  const latest = useRef(params)
  const workerRef = useRef<Worker | null>(null)
  const stopWorkerRef = useRef<(() => void) | null>(null)
  const requestedId = useRef(0)
  const [result, setResult] = useState({ scopeKey: '', ...empty })
  const [status, setStatus] = useState({ scopeKey: '', progress: 0, isComputing: false, error: null as string | null })
  const scopeKey = JSON.stringify([params.enabled, params.base, params.bodies, params.referenceBody, params.historyDays, params.sampleCount, params.sourceKey, params.seekRevision,
    params.expectedCatalogManifestSha256, params.expectedInventoryManifestSha256])
  useEffect(() => { latest.current = params }, [params])
  useEffect(() => {
    const current = latest.current
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setResult({ scopeKey, ...empty })
      setStatus({ scopeKey, progress: 0, isComputing: false, error: current.enabled && !current.base ? 'Historical backend is not configured' : null })
    })
    if (!current.enabled || !current.base || !current.referenceBody || !current.bodies.length) return () => { active = false }
    const bodiesById = new Map(current.bodies.map(body => [body.id, body]))
    let opened: Worker | undefined, detach: () => void
    try {
      opened = new Worker(new URL('../workers/backend-trajectories.worker.ts', import.meta.url), { type: 'module' })
      detach = attachStateTileAdmission(opened)
    } catch (error) {
      opened?.terminate()
      queueMicrotask(() => { if (active) setStatus({ scopeKey, progress: 0, isComputing: false, error: error instanceof Error ? error.message : String(error) }) })
      return () => { active = false }
    }
    const worker = opened
    let closed = false
    const terminate = () => { if (closed) return; closed = true; worker.terminate(); detach() }
    workerRef.current = worker
    const stop = () => {
      terminate()
      if (workerRef.current === worker) workerRef.current = null
      if (stopWorkerRef.current === stop) stopWorkerRef.current = null
    }
    stopWorkerRef.current = stop
    // Intermediate completed epochs remain useful while the latest is queued,
    // but a settled request must never publish again or revive its progress.
    let settledId = requestedId.current
    worker.onmessage = (event: MessageEvent<BackendTrajectoryWorkerResponse>) => {
      if (!active || closed) return
      const response = event.data
      if (!response || !Number.isSafeInteger(response.requestId) || response.requestId < 1 || response.requestId > requestedId.current) {
        fail('Invalid historical worker request identity'); return
      }
      if (response.requestId <= settledId) return
      if (response.type === 'progress' && (!Number.isFinite(response.progress) || response.progress < 0 || response.progress > 1)) {
        fail('Invalid historical worker progress'); return
      }
      if (response.type !== 'progress' && response.type !== 'result' && response.type !== 'error') {
        fail('Invalid historical worker response'); return
      }
      if (response.type === 'error' && typeof response.error !== 'string') {
        fail('Invalid historical worker error'); return
      }
      if (response.type !== 'progress') settledId = response.requestId
      if (response.type === 'progress') setStatus({ scopeKey, progress: response.progress, isComputing: true, error: null })
      else if (response.type === 'result') {
        try {
          setResult({ scopeKey, trajectories: trajectoryViews(response.result.packed, bodiesById), unavailableBodyIds: response.result.packed.trajectoryUnavailableBodyIds, audit: response.result.audit })
          setStatus({ scopeKey, progress: 1, isComputing: response.requestId < requestedId.current, error: null })
        } catch (error) {
          setResult({ scopeKey, ...empty }); setStatus({ scopeKey, progress: 0, isComputing: false, error: String(error) })
        }
      } else {
        setResult({ scopeKey, ...empty })
        setStatus({ scopeKey, progress: 0, isComputing: response.requestId < requestedId.current, error: response.error })
      }
    }
    const fail = (message: string) => {
      if (!active || closed) return
      setResult({ scopeKey, ...empty })
      setStatus({ scopeKey, progress: 0, isComputing: false, error: message })
      stop()
    }
    worker.onerror = event => fail(event.message || 'Historical worker failed')
    worker.onmessageerror = () => fail('Historical worker response could not be decoded')
    return () => {
      active = false
      try { if (!closed) worker.postMessage({ type: 'dispose' } satisfies BackendTrajectoryWorkerRequest) }
      finally { stop() }
    }
  }, [scopeKey])
  useEffect(() => {
    const worker = workerRef.current, current = latest.current
    if (!worker || !current.base || !current.referenceBody) return
    const requestId = ++requestedId.current
    const job: BackendTrajectoryJob = { base: current.base, bodies: current.bodies, referenceBody: current.referenceBody,
      centerUtcJd: current.centerUtcJd, historyDays: current.historyDays, sampleCount: current.sampleCount, requestId,
      expectedCatalogManifestSha256: current.expectedCatalogManifestSha256, expectedInventoryManifestSha256: current.expectedInventoryManifestSha256 }
    try { worker.postMessage({ type: 'compute', job } satisfies BackendTrajectoryWorkerRequest) }
    catch (error) {
      stopWorkerRef.current?.()
      queueMicrotask(() => {
        // A newer worker owns its own status; do not overwrite it.
        if (workerRef.current || requestedId.current !== requestId) return
        setResult({ scopeKey, ...empty })
        setStatus({ scopeKey, progress: 0, isComputing: false, error: error instanceof Error ? error.message : String(error) })
      })
      return
    }
    queueMicrotask(() => { if (workerRef.current === worker) setStatus({ scopeKey, progress: 0, isComputing: true, error: null }) })
  }, [params.centerUtcJd, scopeKey])
  return { ...(result.scopeKey === scopeKey ? result : empty), ...(status.scopeKey === scopeKey ? status : { progress: 0, isComputing: false, error: null }) }
}
