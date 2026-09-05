/// <reference lib="webworker" />
import { loadBackendTrajectories } from '../lib/backendTrajectories'
import { createBackendTrajectoryQueue } from '../lib/backendTrajectoryQueue'
import type { BackendTrajectoryWorkerRequest, BackendTrajectoryWorkerResponse } from './backend-trajectories.protocol'

const scope = self as DedicatedWorkerGlobalScope
const queue = createBackendTrajectoryQueue((job, signal, onProgress) => loadBackendTrajectories({ ...job, signal, onProgress }), {
  progress: (requestId, progress) => scope.postMessage({ type: 'progress', requestId, progress } satisfies BackendTrajectoryWorkerResponse),
  result: (requestId, result) => scope.postMessage({ type: 'result', requestId, result } satisfies BackendTrajectoryWorkerResponse,
    [result.packed.offsets.buffer, result.packed.coordinates.buffer, result.audit.epochsTdbJd.buffer, result.audit.sourceOrdinals.buffer]),
  error: (requestId, error) => scope.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : String(error) } satisfies BackendTrajectoryWorkerResponse),
})
scope.onmessage = (event: MessageEvent<BackendTrajectoryWorkerRequest>) => {
  if (event.data.type === 'dispose') queue.dispose()
  else queue.submit(event.data.job)
}
