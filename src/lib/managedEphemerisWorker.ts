import { EPHEMERIS_MANIFEST } from '../engine/ephemeris/kernelStore'
import { reserveKernelBuffers } from '../engine/ephemeris/kernelBufferBudget'

const filesById = new Map(EPHEMERIS_MANIFEST.files.map(file => [file.id, file]))

/** Charge the union of requested kernels until worker termination, including
 * completed/failed requests: an idle worker can still retain installed files. */
export function managedEphemerisWorker(worker: Worker): Worker {
  const post = worker.postMessage.bind(worker)
  const terminate = worker.terminate.bind(worker)
  const retainedIds = new Set<string>()
  const releases: Array<() => void> = []
  let terminated = false

  function postMessage(message: unknown, transfer: Transferable[]): void
  function postMessage(message: unknown, options?: StructuredSerializeOptions): void
  function postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
    if (terminated) throw new Error('Ephemeris worker has been terminated')
    const ids = message && typeof message === 'object' && 'ephemerisFiles' in message ? message.ephemerisFiles : undefined
    const additions = new Set<string>()
    let bytes = 0
    if (ids !== undefined) {
      if (!Array.isArray(ids)) throw new Error('Invalid worker ephemeris file list')
      for (const id of ids) {
        const file = typeof id === 'string' ? filesById.get(id) : undefined
        if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 128 * 1024 * 1024) {
          throw new Error('Invalid worker ephemeris file')
        }
        if (retainedIds.has(id) || additions.has(id)) continue
        additions.add(id)
        bytes += file.bytes
      }
    }
    const release = reserveKernelBuffers(bytes)
    try {
      if (Array.isArray(transferOrOptions)) post(message, transferOrOptions)
      else post(message, transferOrOptions)
    } catch (error) { release(); throw error }
    if (additions.size) {
      for (const id of additions) retainedIds.add(id)
      releases.push(release)
    } else release()
  }

  worker.postMessage = postMessage
  worker.terminate = () => {
    if (terminated) return
    terminate()
    terminated = true
    for (const release of releases) release()
    releases.length = 0
    retainedIds.clear()
  }
  return worker
}
