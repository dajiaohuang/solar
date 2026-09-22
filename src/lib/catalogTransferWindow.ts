export const CATALOG_TRANSFER_WINDOW = 4

/** Bounds transferred tiles independently of network admission. Acknowledging
 * one tile returns one credit; completion waits for every accepted tile. */
export function createCatalogTransferWindow(signal: AbortSignal, capacity = CATALOG_TRANSFER_WINDOW) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid catalog transfer window')
  type Credit = { done: Promise<void>; resolve: () => void }
  const pending = new Map<number, Credit>()
  let nextId = 0, disposed = false
  const check = () => {
    signal.throwIfAborted()
    if (disposed) throw new Error('Catalog transfer window is closed')
  }
  const release = (id: number) => {
    const credit = pending.get(id)
    if (!credit) return
    pending.delete(id)
    credit.resolve()
  }
  const clear = () => { for (const id of pending.keys()) release(id) }
  signal.addEventListener('abort', clear, { once: true })
  return {
    async publish(send: (tileId: number) => void) {
      check()
      while (pending.size >= capacity) { await Promise.race([...pending.values()].map(credit => credit.done)); check() }
      const id = ++nextId
      let resolve!: () => void
      const done = new Promise<void>(finish => { resolve = finish })
      pending.set(id, { done, resolve })
      try { send(id) }
      catch (error) { release(id); throw error }
      // Stop the producer before it computes a fifth tile. No rejection is
      // left unobserved when cancellation releases several credits together.
      if (pending.size >= capacity) await Promise.race([...pending.values()].map(credit => credit.done))
      check()
    },
    acknowledge: release,
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
