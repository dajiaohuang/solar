type Waiting = { admit: () => void; abort: () => void }

/** Per-realm FIFO admission. Queued requests retain no acquired artifact bytes.
 * A lease covers source loading and all consumers' active format validation. */
export class CatalogAdmission {
  private active = 0
  private readonly queue: Waiting[] = []
  private readonly maximum: number

  constructor(maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new RangeError('Invalid catalog acquisition limit')
    this.maximum = maximum
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    return new Promise((resolve, reject) => {
      const entry: Waiting = {
        abort: () => {
          const index = this.queue.indexOf(entry)
          if (index < 0) return
          this.queue.splice(index, 1)
          signal?.removeEventListener('abort', entry.abort)
          reject(signal?.reason)
        },
        admit: () => {
          signal?.removeEventListener('abort', entry.abort)
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
