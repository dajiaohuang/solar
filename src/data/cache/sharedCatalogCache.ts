type Pending<T> = { controller: AbortController; promise: Promise<T>; consumers: number }

/** Decoded LRU values and in-flight ownership have separate lifetimes. */
export class SharedCatalogCache<T> {
  private readonly values = new Map<string, T>()
  private readonly pending = new Map<string, Pending<T>>()

  private readonly maximumEntries: number

  constructor(maximumEntries: number) { this.maximumEntries = maximumEntries }

  clear() {
    this.values.clear()
    for (const entry of this.pending.values()) entry.controller.abort()
    this.pending.clear()
  }

  get(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.values.has(key)) {
      const value = this.values.get(key)!
      this.values.delete(key)
      this.values.set(key, value)
      return Promise.resolve(value)
    }
    let entry = this.pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      const created: Pending<T> = { controller, consumers: 0, promise: Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return load(controller.signal)
      }).then(value => {
        controller.signal.throwIfAborted()
        if (this.pending.get(key) === created) {
          this.values.set(key, value)
          while (this.values.size > this.maximumEntries) this.values.delete(this.values.keys().next().value!)
        }
        return value
      }).finally(() => {
        if (this.pending.get(key) === created) this.pending.delete(key)
      }) }
      entry = created
      this.pending.set(key, created)
    }
    const owned = entry
    owned.consumers++
    return new Promise<T>((resolve, reject) => {
      let finished = false
      const finish = (settle: () => void) => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', abort)
        owned.controller.signal.removeEventListener('abort', cancelled)
        if (--owned.consumers === 0 && this.pending.get(key) === owned) {
          this.pending.delete(key)
          owned.controller.abort()
        }
        settle()
      }
      const abort = () => finish(() => reject(signal?.reason))
      const cancelled = () => finish(() => reject(owned.controller.signal.reason))
      signal?.addEventListener('abort', abort, { once: true })
      owned.controller.signal.addEventListener('abort', cancelled, { once: true })
      owned.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)))
      if (signal?.aborted) abort()
    })
  }
}

/** Failure or cancellation also releases unfinished sibling reads. */
export async function catalogBatch<T>(signal: AbortSignal | readonly AbortSignal[] | undefined, run: (signal: AbortSignal) => Promise<T>) {
  const signals: readonly AbortSignal[] = signal ? ('aborted' in signal ? [signal] : signal) : []
  for (const source of signals) source.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signals.find(source => source.aborted)?.reason)
  for (const source of signals) source.addEventListener('abort', abort, { once: true })
  try {
    const result = await run(controller.signal)
    controller.signal.throwIfAborted()
    return result
  } finally {
    for (const source of signals) source.removeEventListener('abort', abort)
    controller.abort()
  }
}
