import { selectedEphemerisManifest as manifestData } from '../../data/selectedEphemerisManifest'
import { bodyNaifId } from '../../data/ephemerisTargets'
import { exactEphemerisFiles, selectEphemerisFiles } from '../../data/ephemerisSelection'
import { SpkKernel } from './spk'
import { createKernelResolver, kernelsCoveringInterval, type LoadedKernel } from './kernelPool'
import { utcJulianDayToEt } from './timeScales'
import type { CelestialBody } from '../../types'
import type { RuntimeKernelFile } from './runtimeManifest'
import { reserveKernelBuffers } from './kernelBufferBudget'
import { SEGMENTED_WEB } from '../../lib/webExecution'

export type KernelFile = RuntimeKernelFile & { sourceIdentity?: unknown }
export const EPHEMERIS_MANIFEST = manifestData as { schemaVersion: number; id: string; profile?: string; files: KernelFile[] }
const installed = new Map<string, LoadedKernel>()
// Only successful byte verification may create these receipts. Weak keys do
// not extend a kernel's lifetime, and an identical name cannot borrow a receipt.
const verifiedSources = new WeakMap<SpkKernel, { id: string; sha256: string }>()
export function verifiedKernelSha256(source: Pick<LoadedKernel, 'id' | 'kernel'>): string | null {
  const receipt = verifiedSources.get(source.kernel)
  return receipt?.id === source.id ? receipt.sha256 : null
}
let orderedSnapshot: { ids: readonly string[]; kernels: LoadedKernel[] } | null = null
function orderedInstalled() {
  if (!orderedSnapshot) {
    const ids = EPHEMERIS_MANIFEST.files.filter(file => installed.has(file.id)).map(file => file.id)
    orderedSnapshot = { ids: Object.freeze(ids), kernels: ids.map(id => installed.get(id)!) }
  }
  return orderedSnapshot
}
// The status panel asks for many bodies at the same epoch. Share the immutable
// pool snapshot and center cache rather than rebuilding them for every row.
let currentResolver: { et: number; resolver: ReturnType<typeof createKernelResolver> } | null = null
type PendingKernelLoad = { promise: Promise<void>; controller: AbortController; consumers: number; abandoned: boolean }
const pending = new Map<string, PendingKernelLoad>()
const failures = new Map<string, string>()
const failureMessage = () => [...failures.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, message]) => message).join('\n') || null
let activeLoads = 0
let loadingCount = 0
type LoadWaiter = { signal: AbortSignal; resolve: () => void; reject: (reason: unknown) => void; onAbort: () => void }
const loadWaiters: LoadWaiter[] = []
function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Ephemeris loading cancelled', 'AbortError')
}
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal)
}
function waitWithAbort(promise: Promise<void>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(abortReason(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    if (signal.aborted) onAbort()
  })
}
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError'
function releaseLoadSlot() {
  let next: LoadWaiter | undefined
  while ((next = loadWaiters.shift())) {
    next.signal.removeEventListener('abort', next.onAbort)
    if (next.signal.aborted) { next.reject(abortReason(next.signal)); continue }
    next.resolve()
    return
  }
  activeLoads--
}
async function withLoadSlot(load: () => Promise<void>, signal: AbortSignal) {
  throwIfAborted(signal)
  if (activeLoads < 4) activeLoads++
  else await new Promise<void>((resolve, reject) => {
    const waiter: LoadWaiter = { signal, resolve, reject, onAbort: () => {
      const index = loadWaiters.indexOf(waiter)
      if (index < 0) return
      loadWaiters.splice(index, 1)
      signal.removeEventListener('abort', waiter.onAbort)
      reject(abortReason(signal))
    } }
    loadWaiters.push(waiter)
    signal.addEventListener('abort', waiter.onAbort, { once: true })
    if (signal.aborted) waiter.onAbort()
  })
  try { await load() }
  finally { releaseLoadSlot() }
}
const listeners = new Set<() => void>()
let snapshot = { revision: 0, loading: 0, error: null as string | null }
let pendingPublish: Partial<typeof snapshot> | null = null
let pendingInvalidation = false
let publishTimer: ReturnType<typeof setTimeout> | null = null
const emit = (patch: Partial<typeof snapshot>, invalidates = false) => {
  snapshot = { ...snapshot, ...patch, revision: snapshot.revision + (invalidates ? 1 : 0) }
  listeners.forEach((listener) => listener())
}
const flushPendingPublish = () => {
  if (publishTimer !== null) { clearTimeout(publishTimer); publishTimer = null }
  if (!pendingPublish) return
  const patch = pendingPublish
  pendingPublish = null
  const invalidates = pendingInvalidation
  pendingInvalidation = false
  emit({ ...patch, loading: loadingCount }, invalidates)
}
const publish = (patch: Partial<typeof snapshot> = {}, invalidates = false) => {
  flushPendingPublish()
  emit({ ...patch, loading: patch.loading ?? loadingCount }, invalidates)
}
const publishSoon = (patch: Partial<typeof snapshot> = {}, invalidates = false) => {
  pendingPublish = { ...pendingPublish, ...patch, loading: loadingCount }
  pendingInvalidation ||= invalidates
  if (publishTimer !== null) return
  publishTimer = setTimeout(flushPendingPublish, 100)
}
export const subscribeEphemerides = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getEphemerisSnapshot = () => snapshot
export const loadedKernelIds = () => [...orderedInstalled().ids]
export const loadedKernels = () => [...orderedInstalled().kernels]
export function kernelsForWindow(startUtcJd: number, endUtcJd: number, ids = loadedKernelIds()) {
  try {
    const wanted = new Set(ids)
    return kernelsCoveringInterval(loadedKernels().filter((kernel) => wanted.has(kernel.id)), utcJulianDayToEt(startUtcJd), utcJulianDayToEt(endUtcJd))
  } catch { return [] }
}

export async function installKernel(id: string, buffer: ArrayBuffer, publishNow = true) {
  // Replacements can remain referenced by existing resolvers. Do not treat
  // their old buffer as reclaimable before those consumers have released it.
  if (installed.has(id)) throw new Error(`Ephemeris ${id}: already installed`)
  const source = EPHEMERIS_MANIFEST.files.find(file => file.id === id)
  if (!source) throw new Error(`Unknown ephemeris file ${id}`)
  const file = { ...source, solutionKernelIds: source.solutionKernelIds?.slice() }
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 128 * 1024 * 1024 || buffer.byteLength !== file.bytes) throw new Error(`Ephemeris ${id}: unexpected size`)
  const release = reserveKernelBuffers(buffer.byteLength)
  let retained = false
  try {
    // Own the bytes before the first await: callers cannot mutate or detach
    // the scientific source while hashing or after registration.
    const owned = buffer.slice(0)
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (digest !== file.sha256) throw new Error(`Ephemeris ${id}: checksum mismatch`)
    if (installed.has(id)) throw new Error(`Ephemeris ${id}: already installed`)
    const kernel = new SpkKernel(owned)
    registerKernel(file, kernel, digest, false)
    retained = true
    if (publishNow) publish({ error: failureMessage() }, true)
  } finally {
    if (!retained) release()
  }
}

function registerKernel(file: KernelFile, kernel: SpkKernel, verifiedSha256: string, publishNow: boolean) {
  const id = file.id
  verifiedSources.set(kernel, { id, sha256: verifiedSha256 })
  installed.set(id, Object.freeze({ id, kernel, sha256: verifiedSha256,
    solutionKernelIds: file.solutionKernelIds === undefined ? undefined : Object.freeze(file.solutionKernelIds.slice()),
    dependencyOnly: file.dependencyOnly }))
  orderedSnapshot = null
  currentResolver = null
  // A different successful file must not hide a still-missing dependency.
  failures.delete(id)
  if (publishNow) publish({ error: failureMessage() }, true)
}

async function loadFile(source: KernelFile, signal: AbortSignal) {
  const file = { ...source, solutionKernelIds: source.solutionKernelIds?.slice() }
  if (file.bytes <= 0 || file.bytes > 128 * 1024 * 1024 || !Number.isSafeInteger(file.bytes)) throw new Error('Invalid ephemeris size limit')
  throwIfAborted(signal)
  if (installed.has(file.id)) return
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const deadline = performance.now() + 60000
  const timer = setTimeout(() => controller.abort(), 60000)
  const checkDeadline = () => {
    if (signal.aborted) throw abortReason(signal)
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort()
      throw new Error(`Ephemeris ${file.id}: loading deadline exceeded`)
    }
  }
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let consumed = false
  let release: (() => void) | undefined
  let retained = false
  try {
    release = reserveKernelBuffers(file.bytes)
    response = await fetch(`${import.meta.env.BASE_URL}data/ephemerides/${file.path}`, { signal: controller.signal })
    checkDeadline()
    if (!response.ok) throw new Error(`Ephemeris ${file.id}: HTTP ${response.status}`)
    reader = response.body?.getReader()
    if (!reader) throw new Error(`Ephemeris ${file.id}: response body unavailable`)
    const bytes = new Uint8Array(file.bytes)
    let offset = 0
    while (true) {
      const chunk = await reader.read()
      checkDeadline()
      if (chunk.done) { consumed = true; break }
      if (offset + chunk.value.length > bytes.length) throw new Error(`Ephemeris ${file.id}: oversized response`)
      bytes.set(chunk.value, offset)
      offset += chunk.value.length
    }
    if (offset !== bytes.length) throw new Error(`Ephemeris ${file.id}: truncated response`)
    const buffer = bytes.buffer
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    checkDeadline()
    if (digest !== file.sha256) throw new Error(`Ephemeris ${file.id}: checksum mismatch`)
    const kernel = new SpkKernel(buffer)
    checkDeadline()
    // A direct installer may have supplied this identity while fetch awaited.
    if (installed.has(file.id)) return
    registerKernel(file, kernel, digest, false)
    retained = true
    publishSoon({ error: failureMessage() }, true)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    try {
      if (!consumed) {
        controller.abort()
        // Cleanup must not replace the original fetch, size or parse failure.
        try {
          if (reader) await reader.cancel()
          else await response?.body?.cancel()
        } catch { /* An aborted transport may already have errored its stream. */ }
      }
      reader?.releaseLock()
    } finally {
      if (!retained) release?.()
    }
  }
}

function beginKernelLoad(file: KernelFile) {
  loadingCount += 1
  if (loadingCount === 1) publish({ loading: loadingCount })
  else publishSoon()
  const controller = new AbortController()
  const task: PendingKernelLoad = { promise: Promise.resolve(), controller, consumers: 0, abandoned: false }
  pending.set(file.id, task)
  task.promise = withLoadSlot(() => loadFile(file, controller.signal), controller.signal).catch((error: unknown) => {
    // A request that lost its final consumer is not a source failure and must
    // not poison the persistent status or suppress a later retry.
    if (!task.abandoned) {
      failures.set(file.id, error instanceof Error ? error.message : String(error))
      publishSoon({ error: failureMessage() })
    }
    throw error
  }).finally(() => {
    if (pending.get(file.id) === task) pending.delete(file.id)
    loadingCount = Math.max(0, loadingCount - 1)
    publishSoon({ error: failureMessage() })
  })
  return task
}

async function awaitKernelFile(file: KernelFile, signal?: AbortSignal) {
  while (true) {
    throwIfAborted(signal)
    if (installed.has(file.id)) return
    const task = pending.get(file.id) ?? beginKernelLoad(file)
    task.consumers += 1
    try {
      await waitWithAbort(task.promise, signal)
      return
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      // A different caller may have abandoned the shared load just before this
      // caller joined it. Wait for its cleanup, then create a fresh task.
      if (!(task.abandoned && isAbortError(error))) throw error
    } finally {
      task.consumers -= 1
      if (task.consumers === 0 && pending.get(file.id) === task && !task.abandoned) {
        task.abandoned = true
        task.controller.abort(new DOMException('No callers still require this ephemeris file', 'AbortError'))
      }
    }
  }
}

/** Exact file set is sent to workers: no hidden high/low precision divergence.
 * Cancellation stops this caller's remaining queue; a shared file download is
 * aborted only after its final consumer leaves. */
export async function ensureKernelFiles(ids: string[], signal?: AbortSignal) {
  throwIfAborted(signal)
  const files = exactEphemerisFiles(EPHEMERIS_MANIFEST.files, ids)
  let cursor = 0
  let failed = false
  // Bound transient read/hash buffers. Hundreds of small per-body files should
  // not pay a complete serial network round trip each, nor all load at once.
  const consume = async () => {
    while (!failed && cursor < files.length) {
      throwIfAborted(signal)
      const file = files[cursor++]
      try { await awaitKernelFile(file, signal) } catch (error) { failed = true; throw error }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, consume))
  } finally {
    // Do not leave the last successful batch waiting on a timer. On an early
    // rejection, peers may still be loading, so their non-zero state remains.
    if (loadingCount === 0) flushPendingPublish()
  }
}

export function kernelFilesForBodies(bodies: { id: string; naifId?: number }[]) {
  if (SEGMENTED_WEB) return []
  const targets = new Set(bodies.map(bodyNaifId).filter((id) => id !== undefined))
  return selectEphemerisFiles(EPHEMERIS_MANIFEST.files, targets).map(file => file.id)
}

export function kernelStateForBody(body: { id: string; naifId?: number }, utcJd: number) {
  const target = bodyNaifId(body)
  if (target === undefined || !installed.size) return null
  // The civil-time conversion declares its supported historical boundary.
  // Older scenes retain their documented approximate model, never fake UTC.
  let et: number
  try { et = utcJulianDayToEt(utcJd) } catch { return null }
  if (!currentResolver || currentResolver.et !== et) currentResolver = { et, resolver: createKernelResolver(loadedKernels(), et) }
  return currentResolver.resolver.relative(target, 10)
}

export function kernelCoverage(body: Pick<CelestialBody, 'id' | 'naifId' | 'orbit'>, utcJd: number) {
  const target = bodyNaifId(body)
  const state = kernelStateForBody(body, utcJd)
  return { target, model: state ? 'jpl-spk' : body.id === 'sun' ? 'heliocentric-origin' : body.orbit ? 'approximate-fallback' : 'unavailable', kernelIds: orderedInstalled().ids, manifestId: EPHEMERIS_MANIFEST.id }
}
