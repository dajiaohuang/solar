/** A permit covers one tile's HTTP body and integrity decoding, not retained
 * scientific snapshots or display budgets. Release only after that work ends. */
export type AcquireStateTile = (signal: AbortSignal) => Promise<() => void>

export const WEB_STATE_TILE_IN_FLIGHT = 2
export const WEB_STATE_TILE_QUEUED = 32
export type StateTileAdmissionInit = { type: 'init-tile-admission'; port: MessagePort }
type AdmissionRequest = { type: 'acquire' | 'cancel' | 'release'; id: number }
type AdmissionResponse = { type: 'granted'; id: number } | { type: 'rejected'; id: number; error: string }
type Waiting = { signal: AbortSignal; abort: () => void; resolve: (release: () => void) => void; reject: (error: unknown) => void }
const aborted = () => new DOMException('Aborted', 'AbortError')

/** FIFO admission across current/history workers. Each producer already has
 * at most two tile tasks; FIFO prevents its retries from jumping other work. */
export function createStateTileAdmissionPool(capacity = WEB_STATE_TILE_IN_FLIGHT, maxQueued = WEB_STATE_TILE_QUEUED) {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxQueued) || maxQueued < 0) throw new Error('Invalid tile admission limits')
  const queue: Waiting[] = []
  let active = 0, peakActive = 0, admitted = 0, rejected = 0
  function drain() {
    while (active < capacity && queue.length) {
      const next = queue.shift()!
      next.signal.removeEventListener('abort', next.abort)
      if (next.signal.aborted) { next.reject(next.signal.reason ?? aborted()); continue }
      active++; admitted++; peakActive = Math.max(peakActive, active)
      let released = false
      next.resolve(() => { if (released) return; released = true; active--; drain() })
    }
  }
  const acquire: AcquireStateTile = signal => {
    if (signal.aborted) return Promise.reject(signal.reason ?? aborted())
    if (active >= capacity && queue.length >= maxQueued) { rejected++; return Promise.reject(new Error('Web state-tile admission queue is full')) }
    return new Promise((resolve, reject) => {
      const next: Waiting = { signal, resolve, reject, abort: () => {
        const index = queue.indexOf(next)
        if (index < 0) return
        queue.splice(index, 1); reject(signal.reason ?? aborted())
      } }
      signal.addEventListener('abort', next.abort, { once: true })
      queue.push(next); drain()
    })
  }
  return { acquire, snapshot: () => ({ capacity, maxQueued, active, queued: queue.length, peakActive, admitted, rejected }) }
}

/** Main-thread endpoint. Only integer permit messages cross this channel;
 * all scientific fetch/parse/Float64 work remains inside the requesting worker. */
export function serveStateTileAdmission(port: MessagePort, pool: ReturnType<typeof createStateTileAdmissionPool>) {
  const requests = new Map<number, { controller: AbortController; release?: () => void }>()
  let closed = false
  const retire = (id: number) => {
    const request = requests.get(id)
    if (!request) return
    requests.delete(id); request.controller.abort(); request.release?.()
  }
  port.onmessage = (event: MessageEvent<AdmissionRequest>) => {
    const message = event.data
    if (closed || !message || !Number.isSafeInteger(message.id) || message.id < 1) return
    if (message.type === 'cancel' || message.type === 'release') { retire(message.id); return }
    if (message.type !== 'acquire' || requests.has(message.id)) return
    const request: { controller: AbortController; release?: () => void } = { controller: new AbortController() }
    requests.set(message.id, request)
    void pool.acquire(request.controller.signal).then(release => {
      if (closed || requests.get(message.id) !== request) { release(); return }
      request.release = release
      try { port.postMessage({ type: 'granted', id: message.id } satisfies AdmissionResponse) }
      catch { retire(message.id) }
    }, error => {
      if (closed || requests.get(message.id) !== request) return
      requests.delete(message.id)
      port.postMessage({ type: 'rejected', id: message.id, error: error instanceof Error ? error.message : String(error) } satisfies AdmissionResponse)
    })
  }
  return () => {
    if (closed) return
    closed = true; port.onmessage = null; port.close()
    for (const id of requests.keys()) retire(id)
  }
}

/** Worker endpoint. Cancelling a queued acquisition retires it immediately;
 * a racing late grant is returned without ever starting its HTTP request. */
export function createWorkerTileAdmission(port: MessagePort) {
  const waiting = new Map<number, { resolve: (release: () => void) => void; reject: (error: unknown) => void; removeAbort: () => void }>()
  let nextId = 0, closed = false
  port.onmessage = (event: MessageEvent<AdmissionResponse>) => {
    const response = event.data, request = waiting.get(response.id)
    if (closed) return
    if (!request) { if (response.type === 'granted') port.postMessage({ type: 'release', id: response.id } satisfies AdmissionRequest); return }
    waiting.delete(response.id); request.removeAbort()
    if (response.type === 'rejected') { request.reject(new Error(response.error)); return }
    let released = false
    request.resolve(() => {
      if (released) return
      released = true
      if (!closed) port.postMessage({ type: 'release', id: response.id } satisfies AdmissionRequest)
    })
  }
  const acquire: AcquireStateTile = signal => {
    if (closed) return Promise.reject(new Error('Web state-tile admission is closed'))
    if (signal.aborted) return Promise.reject(signal.reason ?? aborted())
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const abort = () => {
        if (!waiting.delete(id)) return
        port.postMessage({ type: 'cancel', id } satisfies AdmissionRequest)
        reject(signal.reason ?? aborted())
      }
      signal.addEventListener('abort', abort, { once: true })
      waiting.set(id, { resolve, reject, removeAbort: () => signal.removeEventListener('abort', abort) })
      try { port.postMessage({ type: 'acquire', id } satisfies AdmissionRequest) }
      catch (error) { waiting.delete(id); signal.removeEventListener('abort', abort); reject(error) }
    })
  }
  return { acquire, dispose() {
    if (closed) return
    closed = true
    for (const [id, request] of waiting) {
      request.removeAbort(); request.reject(new DOMException('Disposed', 'AbortError'))
      port.postMessage({ type: 'cancel', id } satisfies AdmissionRequest)
    }
    waiting.clear(); port.onmessage = null; port.close()
  } }
}

let sharedPool: ReturnType<typeof createStateTileAdmissionPool> | undefined
function pagePool() { return sharedPool ??= createStateTileAdmissionPool() }
export function stateTileAdmissionSnapshot() { return pagePool().snapshot() }

/** Attach once before posting jobs. The owner must terminate its worker before
 * detaching, so no outstanding transport can keep using a returned permit. */
export function attachStateTileAdmission(worker: Pick<Worker, 'postMessage'>) {
  const channel = new MessageChannel()
  const detach = serveStateTileAdmission(channel.port1, pagePool())
  try { worker.postMessage({ type: 'init-tile-admission', port: channel.port2 } satisfies StateTileAdmissionInit, [channel.port2]) }
  catch (error) { detach(); channel.port2.close(); throw error }
  return () => { detach(); channel.port2.close() }
}
