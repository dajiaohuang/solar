import { useEffect, useRef, useState } from 'react'
import type { BackendTrajectoryJob } from '../lib/backendTrajectoryQueue'
import type { BackendTrajectoryAudit } from '../lib/backendTrajectories'
import { trajectoryViews } from '../lib/trajectorySamples'
import type { BackendTrajectoryWorkerRequest, BackendTrajectoryWorkerResponse } from '../workers/backend-trajectories.protocol'
import type { CelestialBody, TrajectorySample } from '../types'

type Params = Omit<BackendTrajectoryJob, 'requestId' | 'base' | 'referenceBody'> & { enabled: boolean; base: string | null; referenceBody?: CelestialBody; sourceKey: string; seekRevision: number }
const empty = { trajectories: [] as TrajectorySample[], unavailableBodyIds: [] as string[], audit: undefined as BackendTrajectoryAudit | undefined }

export function useBackendTrajectoryWorker(params: Params) {
  const latest = useRef(params)
  const workerRef = useRef<Worker | null>(null)
  const requestedId = useRef(0)
  const [result, setResult] = useState({ scopeKey: '', ...empty })
  const [status, setStatus] = useState({ scopeKey: '', progress: 0, isComputing: false, error: null as string | null })
  const scopeKey = JSON.stringify([params.enabled, params.base, params.bodies, params.referenceBody, params.historyDays, params.sampleCount, params.sourceKey, params.seekRevision])
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
    const worker = new Worker(new URL('../workers/backend-trajectories.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<BackendTrajectoryWorkerResponse>) => {
      if (!active) return
      const response = event.data
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
    worker.onerror = event => {
      if (!active) return
      setResult({ scopeKey, ...empty })
      setStatus({ scopeKey, progress: 0, isComputing: false, error: event.message || 'Historical worker failed' })
      worker.terminate(); if (workerRef.current === worker) workerRef.current = null
    }
    return () => {
      active = false
      worker.postMessage({ type: 'dispose' } satisfies BackendTrajectoryWorkerRequest)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [scopeKey])
  useEffect(() => {
    const worker = workerRef.current, current = latest.current
    if (!worker || !current.base || !current.referenceBody) return
    const requestId = ++requestedId.current
    const job: BackendTrajectoryJob = { base: current.base, bodies: current.bodies, referenceBody: current.referenceBody,
      centerUtcJd: current.centerUtcJd, historyDays: current.historyDays, sampleCount: current.sampleCount, requestId,
      expectedCatalogManifestSha256: current.expectedCatalogManifestSha256, expectedInventoryManifestSha256: current.expectedInventoryManifestSha256 }
    worker.postMessage({ type: 'compute', job } satisfies BackendTrajectoryWorkerRequest)
    queueMicrotask(() => { if (workerRef.current === worker) setStatus({ scopeKey, progress: 0, isComputing: true, error: null }) })
  }, [params.centerUtcJd, scopeKey])
  return { ...(result.scopeKey === scopeKey ? result : empty), ...(status.scopeKey === scopeKey ? status : { progress: 0, isComputing: false, error: null }) }
}
