import { checkOccultationInputBinding, type OccultationInputBinding } from './occultationReceipt'
import { checkEllipsoidRayContactInputBinding } from './ellipsoidRayContactReceipt'
import { dynamicsSourceBase64 } from './dynamicsSourceBytes'
import { reserveKernelBuffers } from '../engine/ephemeris/kernelBufferBudget'
import { DE440_DYNAMICS_SOURCE } from '../engine/dynamics/de440Source'
import type { OccultationWorkerRequest, OccultationWorkerResponse } from '../workers/occultation.protocol'

export const OCCULTATION_JOB_TIMEOUT_MS = 30_000
export type OccultationJob = { terminate: () => void }
type Completed = Extract<OccultationWorkerResponse, { type: 'done' }>

/** One worker per request; the main-thread deadline covers synchronous compute
 * that cannot service a worker-local timer. Envelope checks are not a scientific
 * geometry validator or a numerical accuracy claim. Main-thread parsing cannot
 * be preempted, so acceptance boundaries also check the monotonic deadline. */
export function startOccultationJob(message: OccultationWorkerRequest, transfer: Transferable[], callbacks: {
  done: (response: Completed) => void
  error: (message: string) => void
}): OccultationJob {
  const deadline = performance.now() + OCCULTATION_JOB_TIMEOUT_MS
  const timeoutMessage = 'Occultation calculation exceeded its 30-second resource limit.'
  const calculation = message.calculation ?? 'contacts'
  if (!['contacts', 'limb', 'stellar-limb', 'ellipsoid-ray-contacts'].includes(calculation) ||
      !(message.inputBytes instanceof ArrayBuffer) || !message.inputBytes.byteLength || message.inputBytes.byteLength > 65_536) {
    throw new Error('Invalid bounded occultation job request')
  }
  // Each worker transfers its sole downloaded SPK buffer into the parsed
  // dynamics kernel. Keep one raw source buffer charged through termination.
  const releaseKernelBudget = reserveKernelBuffers(DE440_DYNAMICS_SOURCE.bytes)
  let worker: Worker
  try { worker = new Worker(new URL('../workers/occultation.worker.ts', import.meta.url), { type: 'module' }) }
  catch (error) { releaseKernelBudget(); throw error }
  let terminal = false, checking = false
  let binding: Promise<OccultationInputBinding>

  const terminate = () => {
    if (terminal) return
    terminal = true
    clearTimeout(timer)
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
    worker.terminate()
    releaseKernelBudget()
  }
  const fail = (message: string) => {
    if (terminal) return
    terminate()
    callbacks.error(message)
  }
  const expired = () => {
    if (performance.now() < deadline) return false
    fail(timeoutMessage)
    return true
  }
  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (terminal || expired() || checking) return
    const response = event.data as { type?: unknown; calculation?: unknown; receipt?: unknown; error?: unknown } | null
    if (response?.type === 'error' && typeof response.error === 'string') { fail(response.error); return }
    const receipt = response?.receipt as { schemaVersion?: unknown } | null
    const expectedReceiptSchemaVersion = calculation === 'contacts' ? 2 : 1
    if (response?.type !== 'done' || response.calculation !== calculation || !receipt ||
        typeof receipt !== 'object' || Array.isArray(receipt) || receipt.schemaVersion !== expectedReceiptSchemaVersion) {
      fail('Invalid occultation worker response'); return
    }
    checking = true
    void binding.then(expected => {
      if (terminal || expired()) return
      if (calculation === 'ellipsoid-ray-contacts') checkEllipsoidRayContactInputBinding(response.receipt, expected.input)
      else checkOccultationInputBinding(response.receipt, expected)
      if (expired()) return
      terminate()
      callbacks.done(response as Completed)
    }).catch(error => fail(error instanceof Error ? error.message : String(error)))
  }
  worker.onerror = event => { event.preventDefault(); fail(event.message || 'Occultation worker failed') }
  worker.onmessageerror = () => fail('Occultation worker response could not be decoded')
  const timer = setTimeout(() => fail(timeoutMessage), Math.max(0, deadline-performance.now()))
  try {
    const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      value => value.toString(16).padStart(2, '0')).join('')
    // Capture originals before transfer detaches buffers. Both digest promises
    // are owned by the job and covered by its deadline and cancellation.
    const inputBytes = message.inputBytes.slice(0)
    const originalBase64 = dynamicsSourceBase64(inputBytes)
    const payloadJson = JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputBytes)))
    let observer: Promise<NonNullable<OccultationInputBinding['observer']>> | undefined
    if (message.calculation === 'stellar-limb') {
      if (!(message.observerResponseBytes instanceof ArrayBuffer) || !message.observerResponseBytes.byteLength ||
          message.observerResponseBytes.byteLength > 14*1024*1024) throw new Error('Observer receipt exceeds 14 MiB')
      const bytes = message.observerResponseBytes.slice(0)
      const originalResponseJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      const sourceId = message.observerRequest.sourceId, utc = message.observerRequest.utc
      const stationJson = JSON.stringify(message.observerRequest.station)
      observer = digest(bytes).then(sha256 => ({ sha256, bytes: bytes.byteLength, originalResponseJson, sourceId, utc, stationJson }))
    }
    binding = Promise.all([digest(inputBytes), observer]).then(([sha256, observer]) => ({
      calculation,
      input: { sha256, bytes: inputBytes.byteLength, originalBase64, payloadJson }, ...(observer ? { observer } : {}),
    }))
    void binding.catch(error => fail(error instanceof Error ? error.message : String(error)))
    if (performance.now() >= deadline) throw new Error(timeoutMessage)
    worker.postMessage(message, transfer)
  }
  catch (error) { terminate(); throw error }
  return { terminate }
}
