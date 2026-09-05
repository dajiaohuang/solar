/// <reference lib="webworker" />
import { loadBackendTrajectories } from '../lib/backendTrajectories'
import { createBackendTrajectoryQueue } from '../lib/backendTrajectoryQueue'
import type { BackendTrajectoryWorkerRequest, BackendTrajectoryWorkerResponse } from './backend-trajectories.protocol'
import { createWorkerTileAdmission } from '../lib/stateTileAdmission'

const scope = self as DedicatedWorkerGlobalScope
let admission: ReturnType<typeof createWorkerTileAdmission> | null = null
const queue = createBackendTrajectoryQueue((job, signal, onProgress) => {
  if (!admission) return Promise.reject(new Error('Historical tile admission is not configured'))
  return loadBackendTrajectories({ ...job, signal, onProgress, acquireTile: admission.acquire })
}, {
  progress: (requestId, progress) => scope.postMessage({ type: 'progress', requestId, progress } satisfies BackendTrajectoryWorkerResponse),
  result: (requestId, result) => scope.postMessage({ type: 'result', requestId, result } satisfies BackendTrajectoryWorkerResponse,
    [result.packed.offsets.buffer, result.packed.coordinates.buffer, result.audit.epochsTdbJd.buffer, result.audit.sourceOrdinals.buffer]),
  error: (requestId, error) => scope.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : String(error) } satisfies BackendTrajectoryWorkerResponse),
})
scope.onmessage = (event: MessageEvent<BackendTrajectoryWorkerRequest>) => {
  if (event.data.type === 'init-tile-admission') {
    if (admission) { event.data.port.close(); return }
    admission = createWorkerTileAdmission(event.data.port)
  } else if (event.data.type === 'dispose') { queue.dispose(); admission?.dispose() }
  else queue.submit(event.data.job)
}
