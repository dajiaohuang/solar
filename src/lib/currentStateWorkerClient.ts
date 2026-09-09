import type { CurrentStateObservation, CurrentStateObservationRequest } from './currentStateObservation'
import type { CurrentStateWorkerRequest, CurrentStateWorkerResponse } from '../workers/current-states.protocol'
import { attachStateTileAdmission } from './stateTileAdmission'

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
type Pending = { id: number; epochTdbJd: number; epochUtcJd: number; resolve: (value: CurrentStateObservation) => void; reject: (error: unknown) => void; removeAbort: () => void }

/** One reusable worker and one caller-owned request. Cancellation retires the
 * promise immediately; its late messages can never resolve another request. */
export function createCurrentStateWorkerClient(createWorker: () => WorkerPort = () => new Worker(new URL('../workers/current-states.worker.ts', import.meta.url), { type: 'module' })) {
  const worker = createWorker()
  let detach: () => void
  try { detach = attachStateTileAdmission(worker) }
  catch (error) { worker.terminate(); throw error }
  const terminate = () => { worker.terminate(); detach() }
  let pending: Pending | null = null, nextId = 0, closed = false
  const retire = (reason: unknown, sendCancel: boolean) => {
    const request = pending; pending = null
    if (!request) return
    request.removeAbort()
    try { if (sendCancel) worker.postMessage({ type: 'cancel', requestId: request.id } satisfies CurrentStateWorkerRequest) }
    catch { closed = true; terminate() }
    finally { request.reject(reason) }
  }
  worker.onmessage = (event: MessageEvent<CurrentStateWorkerResponse>) => {
    const response = event.data, request = pending
    if (closed || !request || !response || response.requestId !== request.id) return
    pending = null; request.removeAbort()
    if (response.type === 'error') request.reject(new Error(response.error))
    else if (response.type !== 'result' || !response.result) request.reject(new Error('Invalid current-state worker response'))
    else if (response.result.epochTdbJd !== request.epochTdbJd || response.result.epochUtcJd !== request.epochUtcJd) request.reject(new Error('Current-state worker epoch mismatch'))
    else request.resolve(response.result)
  }
  worker.onerror = event => {
    if (closed) return
    closed = true
    retire(new Error(event.message || 'Current-state worker failed'), false)
    terminate()
  }
  return {
    get closed() { return closed },
    load(request: CurrentStateObservationRequest, signal: AbortSignal): Promise<CurrentStateObservation> {
      if (closed) return Promise.reject(new Error('Current-state worker is closed'))
      retire(new DOMException('Replaced', 'AbortError'), true)
      if (closed) return Promise.reject(new Error('Current-state worker is closed'))
      if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const abort = () => { if (pending?.id === id) retire(signal.reason ?? new DOMException('Aborted', 'AbortError'), true) }
        signal.addEventListener('abort', abort, { once: true })
        pending = { id, epochTdbJd: request.epochTdbJd, epochUtcJd: request.epochUtcJd, resolve, reject, removeAbort: () => signal.removeEventListener('abort', abort) }
        try { worker.postMessage({ type: 'load', requestId: id, request } satisfies CurrentStateWorkerRequest) }
        catch (error) { retire(error, false) }
      })
    },
    dispose() {
      if (closed) return
      closed = true; retire(new DOMException('Disposed', 'AbortError'), false)
      terminate()
    },
  }
}
