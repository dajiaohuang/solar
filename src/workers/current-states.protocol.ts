import type { CurrentStateObservation, CurrentStateObservationPartial, CurrentStateObservationRequest } from '../lib/currentStateObservation'

export type CurrentStateWorkerRequest =
  | import('../lib/stateTileAdmission').StateTileAdmissionInit
  | { type: 'load'; requestId: number; request: CurrentStateObservationRequest }
  | { type: 'cancel'; requestId: number }

export type CurrentStateWorkerResponse =
  | { type: 'result'; requestId: number; result: CurrentStateObservation }
  | { type: 'partial'; requestId: number; partial: CurrentStateObservationPartial }
  | { type: 'error'; requestId: number; error: string }
