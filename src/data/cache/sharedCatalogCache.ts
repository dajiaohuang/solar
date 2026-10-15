type Pending<T> = { controller: AbortController; promise: Promise<T>; consumers: number }

/** Decoded LRU values and in-flight ownership have separate lifetimes. */
export class SharedCatalogCache<T> {
  private readonly values = new Map<string, T>()
  private readonly pending = new Map<string, Pending<T>>()
  private readonly weights = new Map<string, number>()
  private retainedWeight = 0

  private readonly maximumEntries: number
  private readonly prepare: (value: T) => T
  private readonly budget?: { maximumWeight: number; weigh: (value: T) => number }

  constructor(maximumEntries: number, prepare: (value: T) => T = value => value,
    budget?: { maximumWeight: number; weigh: (value: T) => number }) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) throw new RangeError('Invalid decoded catalog cache entry budget')
    if (budget && (!Number.isSafeInteger(budget.maximumWeight) || budget.maximumWeight < 0)) throw new RangeError('Invalid decoded catalog cache weight budget')
    this.maximumEntries = maximumEntries
    this.prepare = prepare
    this.budget = budget ? { ...budget } : undefined
  }

  clear() {
    this.values.clear()
    this.weights.clear()
    this.retainedWeight = 0
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
        value = this.prepare(value)
        controller.signal.throwIfAborted()
        if (this.pending.get(key) === created) {
          const weight = this.budget ? this.budget.weigh(value) : 0
          if (!Number.isSafeInteger(weight) || weight < 0) throw new RangeError('Invalid decoded catalog cache value weight')
          if (this.maximumEntries > 0 && (!this.budget || weight <= this.budget.maximumWeight)) {
            while (this.values.size && (this.values.size >= this.maximumEntries ||
                this.budget && this.retainedWeight + weight > this.budget.maximumWeight)) {
              const oldest = this.values.keys().next().value!
              this.retainedWeight -= this.weights.get(oldest) ?? 0
              this.weights.delete(oldest)
              this.values.delete(oldest)
            }
            this.values.set(key, value)
            this.weights.set(key, weight)
            this.retainedWeight += weight
          }
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

/** Bound decoded-result lifetimes as well as network admission. Consumers must
 * retain only requested records; returning whole shards defeats this bound.
 * A failed task aborts siblings before another queue item can be acquired. */
export async function catalogForEachBounded<T>(items: readonly T[], signal: AbortSignal | undefined,
  consume: (item: T, signal: AbortSignal) => Promise<void>) {
  const queue = [...items]
  return catalogBatch(signal, async batchSignal => {
    const controller = new AbortController()
    const abort = () => controller.abort(batchSignal.reason)
    batchSignal.addEventListener('abort', abort, { once: true })
    let next = 0
    const worker = async () => {
      try {
        while (next < queue.length) {
          controller.signal.throwIfAborted()
          const item = queue[next++]
          await consume(item, controller.signal)
          controller.signal.throwIfAborted()
          // Cache hits may otherwise form an uninterrupted microtask chain,
          // preventing input events (including cancellation) from running.
          if (next < queue.length) await new Promise<void>(resolve => setTimeout(resolve, 0))
        }
      } catch (error) { controller.abort(error); throw error }
    }
    try {
      batchSignal.throwIfAborted()
      // Cancellation is a request, not proof that acquired resources have
      // finished cleanup. Drain all active consumers before allowing a retry.
      await Promise.allSettled(Array.from({ length: Math.min(4, queue.length) }, worker))
      controller.signal.throwIfAborted()
    } finally {
      batchSignal.removeEventListener('abort', abort)
      controller.abort()
    }
  })
}
