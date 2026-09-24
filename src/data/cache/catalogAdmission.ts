type Waiting = { admit: () => void; abort: () => void }

export const MAX_QUEUED_CATALOG_ACQUISITIONS = 32
export const CATALOG_ACQUISITION_WAIT_MS = 15_000

/** Per-realm FIFO admission. Queued requests retain no acquired artifact bytes.
 * A lease covers source loading and all consumers' active format validation. */
export class CatalogAdmission {
  private active = 0
  private readonly queue: Waiting[] = []
  private readonly maximum: number
  private readonly maximumQueued: number
  private readonly waitMs: number

  constructor(maximum: number, maximumQueued = MAX_QUEUED_CATALOG_ACQUISITIONS, waitMs = CATALOG_ACQUISITION_WAIT_MS) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(maximumQueued) || maximumQueued < 0 || maximumQueued > 4096 ||
        !Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new RangeError('Invalid catalog acquisition limits')
    this.maximum = maximum
    this.maximumQueued = maximumQueued
    this.waitMs = waitMs
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.active >= this.maximum && this.queue.length >= this.maximumQueued) {
      return Promise.reject(new Error('Catalog acquisition queue is full; reduce concurrent loads'))
    }
    return new Promise((resolve, reject) => {
      const deadline = performance.now() + this.waitMs
      const clean = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', entry.abort)
      }
      const timeout = () => new DOMException('Catalog acquisition queue wait exceeded its deadline', 'TimeoutError')
      const remove = (reason: unknown) => {
        const index = this.queue.indexOf(entry)
        if (index < 0) return
        this.queue.splice(index, 1)
        clean()
        reject(reason)
      }
      const entry: Waiting = {
        abort: () => remove(signal?.reason),
        admit: () => {
          clean()
          // A delayed timer must not grant an expired waiter when a lease is
          // released before its timeout callback gets an event-loop turn.
          if (signal?.aborted) { reject(signal.reason); return }
          if (performance.now() >= deadline) { reject(timeout()); return }
          this.active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active--
            this.drain()
          })
        },
      }
      this.queue.push(entry)
      signal?.addEventListener('abort', entry.abort, { once: true })
      const timer = setTimeout(() => remove(timeout()), this.waitMs)
      this.drain()
    })
  }

  private drain() {
    while (this.active < this.maximum && this.queue.length) this.queue.shift()!.admit()
  }
}

// Four independent artifacts allow paired metadata/binary hydration to overlap.
// Main thread and each worker have separate budgets; this is not a process-wide
// memory bound or a substitute for streaming compute/GPU budgets.
export const MAX_ACTIVE_CATALOG_ACQUISITIONS = 4
export const catalogAdmission = new CatalogAdmission(MAX_ACTIVE_CATALOG_ACQUISITIONS)
