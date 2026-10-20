export const CATALOG_TRANSFER_WINDOW = 4
export const CATALOG_UPLOAD_ACK_TIMEOUT_MS = 30_000

/** Bounds transferred tiles independently of network admission. Acknowledging
 * one tile returns one credit; completion waits for every accepted tile. */
export function createCatalogTransferWindow(signal: AbortSignal, capacity = CATALOG_TRANSFER_WINDOW, timeoutMs = CATALOG_UPLOAD_ACK_TIMEOUT_MS) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid catalog transfer window')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error('Invalid catalog upload ACK deadline')
  type Credit = { done: Promise<void>; resolve: () => void; timer: ReturnType<typeof setTimeout>; deadline: number }
  const pending = new Map<number, Credit>()
  let nextId = 0, disposed = false
  let failure: Error | null = null
  const check = () => {
    signal.throwIfAborted()
    expire()
    if (failure) throw failure
    if (disposed) throw new Error('Catalog transfer window is closed')
  }
  const release = (id: number) => {
    const credit = pending.get(id)
    if (!credit) return
    pending.delete(id)
    clearTimeout(credit.timer)
    credit.resolve()
  }
  const clear = () => { for (const id of pending.keys()) release(id) }
  const expire = () => {
    if (failure || disposed) return
    const now = performance.now()
    for (const credit of pending.values()) {
      if (now < credit.deadline) continue
      failure = new Error(`Catalog upload ACK exceeded ${timeoutMs} ms`)
      clear()
      return
    }
  }
  signal.addEventListener('abort', clear, { once: true })
  return {
    async publish(send: (tileId: number) => void) {
      check()
      while (pending.size >= capacity) { await Promise.race([...pending.values()].map(credit => credit.done)); check() }
      if (nextId >= Number.MAX_SAFE_INTEGER) {
        failure = new Error('Catalog transfer identifiers exhausted')
        clear()
        throw failure
      }
      const id = ++nextId
      const deadline = performance.now() + timeoutMs
      let resolve!: () => void
      const done = new Promise<void>(finish => { resolve = finish })
      const timer = setTimeout(() => {
        if (!pending.has(id) || disposed || failure) return
        // Resolve credits rather than rejecting unobserved per-tile promises.
        // Every blocked publish/drain then reports the same terminal failure.
        failure = new Error(`Catalog upload ACK exceeded ${timeoutMs} ms`)
        clear()
      }, timeoutMs)
      pending.set(id, { done, resolve, timer, deadline })
      try { send(id) }
      catch (error) {
        failure = error instanceof Error ? error : new Error(String(error))
        clear()
        throw failure
      }
      // Stop the producer before it computes a fifth tile. No rejection is
      // left unobserved when cancellation releases several credits together.
      check()
      if (pending.size >= capacity) await Promise.race([...pending.values()].map(credit => credit.done))
      check()
    },
    acknowledge(id: number) {
      // Timers can run late while the main/worker event loop is busy. A late
      // ACK must not erase the deadline before its timer gets a turn.
      expire()
      if (!failure && !disposed) release(id)
    },
    async drain() {
      check()
      while (pending.size) { await Promise.all([...pending.values()].map(credit => credit.done)); check() }
    },
    dispose() {
      disposed = true
      signal.removeEventListener('abort', clear)
      clear()
    },
  }
}
