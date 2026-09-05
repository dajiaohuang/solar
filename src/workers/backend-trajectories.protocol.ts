import type { BackendTrajectoryJob } from '../lib/backendTrajectoryQueue'
import type { BackendTrajectoryResult } from '../lib/backendTrajectories'

export type BackendTrajectoryWorkerRequest = { type: 'compute'; job: BackendTrajectoryJob } | { type: 'dispose' } | import('../lib/stateTileAdmission').StateTileAdmissionInit
export type BackendTrajectoryWorkerResponse =
  | { type: 'progress'; requestId: number; progress: number }
  | { type: 'result'; requestId: number; result: BackendTrajectoryResult }
  | { type: 'error'; requestId: number; error: string }
