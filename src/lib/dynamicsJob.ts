import { validateDynamicsRequest, type DynamicsRequest } from '../workers/dynamics.protocol'
import { checkDynamicsReceipt } from './dynamicsReceipt'
import { dynamicsSourceBase64 } from './dynamicsSourceBytes'
import { reserveKernelBuffers } from '../engine/ephemeris/kernelBufferBudget'
import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Source'

export const DYNAMICS_JOB_TIMEOUT_MS = 300_000
export type DynamicsJob = { terminate: () => void }

/** One owned worker per experiment. The acceptance deadline includes startup,
 * parsing and source binding. Timers cannot preempt synchronous main-thread
 * work; boundary checks prevent late results from cancelling a delayed timer. */
export function startDynamicsJob<T>(message: DynamicsRequest, transfer: Transferable[], callbacks: {
  done: (receipt: T) => void
  error: (message: string) => void
}): DynamicsJob {
  const deadline = performance.now() + DYNAMICS_JOB_TIMEOUT_MS
  const timeoutMessage = 'Dynamics experiment exceeded its 300-second resource limit; reduce duration or sample count.'
  validateDynamicsRequest(message)
  const request = { ...message, ...(message.eventSearch ? { eventSearch: { ...message.eventSearch } } : {}) }, inputBytes = request.initialBytes.byteLength
  const inputPayload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.initialBytes))
  const originalBase64 = dynamicsSourceBase64(request.initialBytes)
  if (performance.now() >= deadline) throw new Error(timeoutMessage)
  // The dynamics worker transfers its sole downloaded-buffer reference into
  // SpkKernel. Keep that one retained source charged through worker lifetime.
  const releaseKernelBudget = reserveKernelBuffers(DE440_DYNAMICS_SOURCE.bytes)
  let worker: Worker
  try { worker = new Worker(new URL('../workers/dynamics.worker.ts', import.meta.url), { type: 'module' }) }
  catch (error) { releaseKernelBudget(); throw error }
  let terminal = false
  let checking = false
  const acceptance = new AbortController()
  let sourceHash: Promise<string>

  const terminate = () => {
    if (terminal) return
    terminal = true
    acceptance.abort(new DOMException('Dynamics receipt validation cancelled','AbortError'))
    clearTimeout(timer)
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
    worker.terminate()
    releaseKernelBudget()
  }
  const fail = (message: string) => {
    if (terminal) return
    terminate(); callbacks.error(message)
  }
  const expired = () => {
    if (performance.now() < deadline) return false
    fail(timeoutMessage)
    return true
  }
  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (terminal || expired() || checking) return
    const value = event.data as { type?: unknown; receipt?: unknown; error?: unknown } | null
    if (value?.type === 'error' && typeof value.error === 'string') { fail(value.error); return }
    const receipt = value?.receipt as { schemaVersion?: unknown; calculation?: unknown } | null
    if (value?.type !== 'done' || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
        receipt.schemaVersion !== 1 || typeof receipt.calculation !== 'string') {
      fail('Invalid dynamics worker response'); return
    }
    checking = true
    void sourceHash.then(async hash => {
      if (terminal || expired()) return
      await checkDynamicsReceipt(value.receipt, request, hash, inputBytes, inputPayload, originalBase64, acceptance.signal)
      if (terminal || expired()) return
      terminate(); callbacks.done(value.receipt as T)
    }).catch(error => fail(error instanceof Error ? error.message : String(error)))
  }
  worker.onerror = event => { event.preventDefault(); fail(event.message || 'Dynamics worker failed') }
  worker.onmessageerror = () => fail('Dynamics worker response could not be decoded')
  const timer = setTimeout(() => fail(timeoutMessage), Math.max(0, deadline-performance.now()))
  try {
    // Digest an owned copy before transferring the original buffer. Hashing and
    // worker execution may overlap; the deadline remains live through binding.
    sourceHash = crypto.subtle.digest('SHA-256', request.initialBytes.slice(0)).then(bytes =>
      Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join(''))
    void sourceHash.catch(error => fail(error instanceof Error ? error.message : String(error)))
    if (performance.now() >= deadline) throw new Error(timeoutMessage)
    worker.postMessage(request, transfer)
  } catch (error) { terminate(); throw error }
  return { terminate }
}
