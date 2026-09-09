import type { CurrentStateObservation, CurrentStateObservationRequest } from '../lib/currentStateObservation'

export type CurrentStateWorkerRequest =
  | import('../lib/stateTileAdmission').StateTileAdmissionInit
  | { type: 'load'; requestId: number; request: CurrentStateObservationRequest }
  | { type: 'cancel'; requestId: number }

export type CurrentStateWorkerResponse =
  | { type: 'result'; requestId: number; result: CurrentStateObservation }
  | { type: 'error'; requestId: number; error: string }
