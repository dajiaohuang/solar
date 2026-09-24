/** A permit covers one tile's HTTP body and integrity decoding, not retained
 * scientific snapshots or display budgets. Release only after that work ends. */
export type StateTileWorkload = 'interactive' | 'trajectory' | 'bulk'
export type AcquireStateTile = (signal: AbortSignal, workload?: StateTileWorkload) => Promise<() => void>

export const WEB_STATE_TILE_IN_FLIGHT = 2
export const WEB_STATE_TILE_QUEUED = 32
export type StateTileAdmissionInit = { type: 'init-tile-admission'; port: MessagePort }
type AdmissionRequest = { type: 'acquire'; id: number; workload?: StateTileWorkload } | { type: 'cancel' | 'release'; id: number }
type AdmissionResponse = { type: 'granted'; id: number } | { type: 'rejected'; id: number; error: string }
type Waiting = { signal: AbortSignal; abort: () => void; resolve: (release: () => void) => void; reject: (error: unknown) => void }
const aborted = () => new DOMException('Aborted', 'AbortError')
const WORKLOADS: readonly StateTileWorkload[] = ['interactive', 'trajectory', 'bulk']
const ADMISSION_SCHEDULE: readonly StateTileWorkload[] = ['interactive', 'interactive', 'interactive', 'interactive', 'trajectory', 'trajectory', 'bulk']

function isWorkload(value: unknown): value is StateTileWorkload {
  return value === 'interactive' || value === 'trajectory' || value === 'bulk'
}

/** Weighted FIFO admission across current/history workers. Interactive state
 * gets four grants per two trajectory grants and one bulk grant under load. */
export function createStateTileAdmissionPool(capacity = WEB_STATE_TILE_IN_FLIGHT, maxQueued = WEB_STATE_TILE_QUEUED) {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maxQueued) || maxQueued < 0) throw new Error('Invalid tile admission limits')
  const queues: Record<StateTileWorkload, Waiting[]> = { interactive: [], trajectory: [], bulk: [] }
  let active = 0, peakActive = 0, admitted = 0, rejected = 0, cursor = 0
  const queued = () => WORKLOADS.reduce((sum, workload) => sum + queues[workload].length, 0)
  function dequeue() {
    for (let checked = 0; checked < ADMISSION_SCHEDULE.length; checked++) {
      const workload = ADMISSION_SCHEDULE[cursor]
      cursor = (cursor + 1) % ADMISSION_SCHEDULE.length
      const next = queues[workload].shift()
      if (next) return next
    }
    return undefined
  }
  function drain() {
    while (active < capacity) {
      const next = dequeue()
      if (!next) return
      next.signal.removeEventListener('abort', next.abort)
      if (next.signal.aborted) { next.reject(next.signal.reason ?? aborted()); continue }
      active++; admitted++; peakActive = Math.max(peakActive, active)
      let released = false
      next.resolve(() => { if (released) return; released = true; active--; drain() })
    }
  }
  const acquire: AcquireStateTile = (signal, workload = 'interactive') => {
    if (signal.aborted) return Promise.reject(signal.reason ?? aborted())
    if (!isWorkload(workload)) return Promise.reject(new Error('Invalid state-tile workload'))
    const queue = queues[workload]
    if (active >= capacity && queued() >= maxQueued) { rejected++; return Promise.reject(new Error('Web state-tile admission queue is full')) }
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
  return { acquire, snapshot: () => ({ capacity, maxQueued, active, queued: queued(), interactiveQueued: queues.interactive.length,
    trajectoryQueued: queues.trajectory.length, bulkQueued: queues.bulk.length, peakActive, admitted, rejected }) }
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
    if (message.workload !== undefined && !isWorkload(message.workload)) {
      try { port.postMessage({ type: 'rejected', id: message.id, error: 'Invalid state-tile workload' } satisfies AdmissionResponse) }
      catch { /* No request was admitted; the worker can retire during teardown. */ }
      return
    }
    const workload = message.workload ?? 'interactive'
    const request: { controller: AbortController; release?: () => void } = { controller: new AbortController() }
    requests.set(message.id, request)
    void pool.acquire(request.controller.signal, workload).then(release => {
      if (closed || requests.get(message.id) !== request) { release(); return }
      request.release = release
      try { port.postMessage({ type: 'granted', id: message.id } satisfies AdmissionResponse) }
      catch { retire(message.id) }
    }, error => {
      if (closed || requests.get(message.id) !== request) return
      requests.delete(message.id)
      try { port.postMessage({ type: 'rejected', id: message.id, error: error instanceof Error ? error.message : String(error) } satisfies AdmissionResponse) }
      catch { /* The request has already left the pool; owner teardown closes the channel. */ }
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
    const response = event.data
    if (closed || !response || !Number.isSafeInteger(response.id) || response.id < 1 ||
        (response.type !== 'granted' && response.type !== 'rejected') ||
        (response.type === 'rejected' && typeof response.error !== 'string')) return
    const request = waiting.get(response.id)
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
  const acquire: AcquireStateTile = (signal, workload = 'interactive') => {
    if (closed) return Promise.reject(new Error('Web state-tile admission is closed'))
    if (signal.aborted) return Promise.reject(signal.reason ?? aborted())
    if (nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(new Error('Web state-tile admission identifiers exhausted'))
    if (!isWorkload(workload)) return Promise.reject(new Error('Invalid state-tile workload'))
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const abort = () => {
        if (!waiting.delete(id)) return
        try { port.postMessage({ type: 'cancel', id } satisfies AdmissionRequest) }
        catch { /* Owner teardown retires remote permits if the channel has failed. */ }
        finally { reject(signal.reason ?? aborted()) }
      }
      signal.addEventListener('abort', abort, { once: true })
      waiting.set(id, { resolve, reject, removeAbort: () => signal.removeEventListener('abort', abort) })
      try { port.postMessage({ type: 'acquire', id, workload } satisfies AdmissionRequest) }
      catch (error) { waiting.delete(id); signal.removeEventListener('abort', abort); reject(error) }
    })
  }
  return { acquire, dispose() {
    if (closed) return
    closed = true
    for (const [id, request] of waiting) {
      request.removeAbort(); request.reject(new DOMException('Disposed', 'AbortError'))
      try { port.postMessage({ type: 'cancel', id } satisfies AdmissionRequest) }
      catch { /* Continue rejecting other waiters even when this port cannot send. */ }
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
