/// <reference lib="webworker" />
import { currentStateObservationTransfers, loadCurrentStateObservation } from '../lib/currentStateObservation'
import type { CurrentStateWorkerRequest, CurrentStateWorkerResponse } from './current-states.protocol'

const scope = self as DedicatedWorkerGlobalScope
let pending: Extract<CurrentStateWorkerRequest, { type: 'load' }> | null = null
let active: { requestId: number; controller: AbortController } | null = null
let running = false
const DEADLINE_MS = 120_000

async function drain() {
  if (running) return
  running = true
  try {
    while (pending) {
      const job = pending; pending = null
      const controller = new AbortController()
      active = { requestId: job.requestId, controller }
      const deadline = setTimeout(() => controller.abort(new Error('Current-state worker deadline exceeded')), DEADLINE_MS)
      try {
        const result = await loadCurrentStateObservation({ ...job.request, signal: controller.signal })
        controller.signal.throwIfAborted()
        scope.postMessage({ type: 'result', requestId: job.requestId, result } satisfies CurrentStateWorkerResponse, currentStateObservationTransfers(result))
      } catch (error) {
        // An explicitly replaced/cancelled job cannot publish. A deadline is
        // a failure of the still-current job and must reach the UI.
        const reason: unknown = controller.signal.aborted ? controller.signal.reason : error
        if (!controller.signal.aborted || reason instanceof Error && reason.name !== 'AbortError') {
          scope.postMessage({ type: 'error', requestId: job.requestId, error: reason instanceof Error ? reason.message : String(reason) } satisfies CurrentStateWorkerResponse)
        }
      } finally { clearTimeout(deadline); active = null }
    }
  } finally { running = false }
}

scope.onmessage = (event: MessageEvent<CurrentStateWorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (active?.requestId === request.requestId) active.controller.abort()
    if (pending?.requestId === request.requestId) pending = null
    return
  }
  active?.controller.abort()
  pending = request
  void drain()
}
