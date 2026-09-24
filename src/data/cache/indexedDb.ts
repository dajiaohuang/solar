import { MAX_CATALOG_ARTIFACT_BYTES, readBoundedStream } from './boundedStream'
import { CatalogAdmission, catalogAdmission } from './catalogAdmission'
import { CatalogHttpError } from './catalogHttpError'

const DATABASE_NAME = 'solar-atlas-data-v1'
const DATABASE_VERSION = 2
const STORE_NAME = 'immutable-responses'
const MAX_DATASET_CACHE_BYTES = 256 * 1024 * 1024
const MIN_FREE_STORAGE_BYTES = 16 * 1024 * 1024
const OPTIONAL_CACHE_PHASE_MS = 1500
const CATALOG_ACQUISITION_MS = 60_000
const CATALOG_VALIDATION_MS = 30_000
// Shared downloads do not bound copies: every consumer owns its validator input.
// Two admitted copies of at most 64 MiB each; parsed objects, decompression,
// retained caller results and other realms have separate lifetime/budget scopes.
const validationAdmission = new CatalogAdmission(2)

// Optional persistence must not retain every completed network buffer after
// the acquisition lease is released. This is per realm, not browser-wide RSS.
const MAX_PENDING_CACHE_WRITES = 4
const MAX_RETAINED_CACHE_WRITE_BYTES = 64 * 1024 * 1024
type PendingCacheWrite = { key: string; value: ArrayBuffer; bytes: number }
const pendingCacheWrites = new Map<string, PendingCacheWrite>()
let activeCacheWrite: PendingCacheWrite | null = null
let retainedCacheWriteBytes = 0

function scheduleCacheWrite(key: string, value: ArrayBuffer) {
  if (activeCacheWrite?.key === key || pendingCacheWrites.has(key)) return
  const bytes = value.byteLength
  if (!bytes || bytes > MAX_RETAINED_CACHE_WRITE_BYTES - retainedCacheWriteBytes ||
      pendingCacheWrites.size >= MAX_PENDING_CACHE_WRITES) return
  pendingCacheWrites.set(key, { key, value, bytes })
  retainedCacheWriteBytes += bytes
  drainCacheWrites()
}

function drainCacheWrites() {
  if (activeCacheWrite || !pendingCacheWrites.size) return
  const entry = pendingCacheWrites.values().next().value!
  pendingCacheWrites.delete(entry.key)
  activeCacheWrite = entry
  // Keep the reservation through quota checks, pruning and transaction
  // completion. Sibling validated consumers share one queued write per URL.
  void writeCache(entry.key, entry.value).catch(() => undefined).finally(() => {
    retainedCacheWriteBytes -= entry.bytes
    activeCacheWrite = null
    drainCacheWrites()
  })
}

type CacheRecord = {
  buffer: ArrayBuffer
  datasetVersion: string
  byteLength: number
  lastAccessed: number
}

let preparedVersion: string | null = null
let preparePromise: Promise<void> | null = null
type Payload = { buffer: ArrayBuffer; cached: boolean }
type SharedRequest = { promise: Promise<Payload>; controller: AbortController; consumers: number; settled: boolean; releaseAdmission?: () => void }
const inFlight = new Map<string, SharedRequest>()

function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort() }
  })
}

function acquireRequest(url: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  let pending = inFlight.get(url)
  if (!pending) {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const created: SharedRequest = { controller, consumers: 0, settled: false, promise: catalogAdmission.acquire(controller.signal).then(release => {
      created.releaseAdmission = release
      controller.signal.throwIfAborted()
      timeout = setTimeout(() => controller.abort(new DOMException('Catalog acquisition exceeded 60 seconds', 'TimeoutError')), CATALOG_ACQUISITION_MS)
      return loadImmutableArrayBuffer(url, controller.signal)
    }).finally(() => {
      clearTimeout(timeout)
      created.settled = true
      if (!created.consumers) {
        if (inFlight.get(url) === created) inFlight.delete(url)
        created.releaseAdmission?.()
      }
    }) }
    pending = created
    inFlight.set(url, pending)
  }
  pending.consumers++
  const entry = pending
  let released = false
  return { promise: entry.promise, release: () => {
    if (released) return
    released = true
    entry.consumers--
    if (entry.consumers) return
    if (inFlight.get(url) === entry) inFlight.delete(url)
    if (!entry.settled) entry.controller.abort()
    else entry.releaseAdmission?.()
  } }
}

export function datasetVersionFromUrl(url: string) {
  try {
    const pathname = new URL(url, globalThis.location?.href ?? 'https://solar-atlas.invalid/').pathname
    const preview = pathname.match(/\/data\/asteroids\/preview\/([a-f0-9]{64})\/releases\/([^/]+)\//)
    if (preview) return `preview:${preview[1]}:${decodeURIComponent(preview[2])}`
    const match = pathname.match(/\/data\/asteroids\/releases\/([^/]+)\//)
    return match ? decodeURIComponent(match[1]) : 'legacy'
  } catch {
    return 'legacy'
  }
}

export function isObsoleteDatasetVersion(storedVersion: string, activeVersion: string) {
  if (storedVersion === activeVersion) return false
  // Pre-profile records have no trustworthy release identity. Other products
  // coexist in this database and share its global LRU byte budget.
  if (storedVersion === 'legacy') return true
  if (activeVersion === 'legacy') return false
  return storedVersion.startsWith('preview:') === activeVersion.startsWith('preview:')
}

function isCacheRecord(value: unknown): value is CacheRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CacheRecord>
  return candidate.buffer instanceof ArrayBuffer &&
    typeof candidate.datasetVersion === 'string' &&
    candidate.byteLength === candidate.buffer.byteLength &&
    Number.isFinite(candidate.lastAccessed)
}

function openDatabase() {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (!('indexedDB' in globalThis)) {
      resolve(null)
      return
    }
    let settled = false
    const finish = (database: IDBDatabase | null) => {
      if (settled) { database?.close(); return }
      settled = true
      clearTimeout(timeout)
      if (database) database.onversionchange = () => database.close()
      resolve(database)
    }
    // Optional persistence must not block network delivery indefinitely, e.g.
    // when another tab holds an old database open during an upgrade.
    const timeout = setTimeout(() => finish(null), OPTIONAL_CACHE_PHASE_MS)
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION) }
    catch { finish(null); return }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => finish(request.result)
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
}

function boundedStorageEstimate(): Promise<StorageEstimate | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value?: StorageEstimate) => {
      if (settled) return
      settled = true; clearTimeout(timer); resolve(value)
    }
    const timer = setTimeout(() => finish(), OPTIONAL_CACHE_PHASE_MS)
    try { Promise.resolve(globalThis.navigator?.storage?.estimate?.()).then(finish, () => finish()) }
    catch { finish() }
  })
}

async function storageBudget() {
  try {
    const estimate = await boundedStorageEstimate()
    if (!estimate?.quota) return MAX_DATASET_CACHE_BYTES
    return Math.min(MAX_DATASET_CACHE_BYTES, Math.floor(estimate.quota * 0.25))
  } catch {
    return MAX_DATASET_CACHE_BYTES
  }
}

async function hasCapacityFor(byteLength: number) {
  try {
    const estimate = await boundedStorageEstimate()
    if (estimate?.quota === undefined || estimate.usage === undefined) return true
    return estimate.quota - estimate.usage >= byteLength + MIN_FREE_STORAGE_BYTES
  } catch {
    return true
  }
}

async function pruneDatasetCache(activeVersion: string, maximumBytes: number, incoming?: { key: string; record: CacheRecord }) {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve) => {
    let settled = false
    let transaction: IDBTransaction | undefined
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { transaction?.abort() } catch { /* Already complete. */ }
      database.close()
      resolve()
    }
    const timer = setTimeout(finish, OPTIONAL_CACHE_PHASE_MS)
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const activeEntries: Array<{ key: IDBValidKey; byteLength: number; lastAccessed: number }> = []
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
        if (settled) return
        const cursor = cursorRequest.result
        if (!cursor) {
          activeEntries.sort((left, right) => right.lastAccessed - left.lastAccessed)
          // Reserve the new record and replace the old key in this same
          // transaction. Concurrent writers (including other tabs) serialize
          // here, so a burst cannot exceed the budget between periodic prunes.
          let retainedBytes = incoming?.record.byteLength ?? 0
          for (const entry of activeEntries) {
            if (retainedBytes + entry.byteLength > maximumBytes) store.delete(entry.key)
            else retainedBytes += entry.byteLength
          }
          if (incoming) store.put(incoming.record, incoming.key)
          return
        }
        if (incoming && cursor.primaryKey === incoming.key) {
          // Replacement bytes were reserved above; do not count the old copy.
        } else if (!isCacheRecord(cursor.value) || isObsoleteDatasetVersion(cursor.value.datasetVersion, activeVersion)) {
          cursor.delete()
        } else {
          // Retain only metadata. Keeping each record also retains every large
          // ArrayBuffer until sorting completes (up to the whole cache budget).
          activeEntries.push({ key: cursor.primaryKey, byteLength: cursor.value.byteLength, lastAccessed: cursor.value.lastAccessed })
        }
        cursor.continue()
      }
      cursorRequest.onerror = finish
      transaction.oncomplete = finish
      transaction.onerror = finish
      transaction.onabort = finish
    } catch {
      finish()
    }
  })
}

async function prepareDatasetCache(datasetVersion: string) {
  if (preparedVersion === datasetVersion && preparePromise) return preparePromise
  preparedVersion = datasetVersion
  preparePromise = storageBudget()
    .then((budget) => pruneDatasetCache(datasetVersion, budget))
    .catch(() => undefined)
  return preparePromise
}

async function readCache(key: string, signal?: AbortSignal) {
  const database = await openDatabase()
  if (!database) return null
  return new Promise<ArrayBuffer | null>((resolve) => {
    let settled = false
    let cached: ArrayBuffer | null = null
    let transaction: IDBTransaction | undefined
    const finish = (value: ArrayBuffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      try { transaction?.abort() } catch { /* Already complete. */ }
      database.close()
      resolve(value)
    }
    const cancel = () => finish(null)
    const timer = setTimeout(cancel, OPTIONAL_CACHE_PHASE_MS)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => {
        if (settled) return
        // Unversioned legacy buffers cannot establish the identity of a
        // release URL. Reacquire instead of relabelling them as that release.
        if (isCacheRecord(request.result) && request.result.datasetVersion === datasetVersionFromUrl(key) &&
            request.result.byteLength > 0 && request.result.byteLength <= MAX_CATALOG_ARTIFACT_BYTES) {
          cached = request.result.buffer
          store.put({ ...request.result, lastAccessed: Date.now() } satisfies CacheRecord, key)
        } else if (request.result !== undefined) store.delete(key)
      }
      request.onerror = () => finish(null)
      transaction.onabort = () => finish(null)
      transaction.onerror = () => finish(null)
      transaction.oncomplete = () => finish(cached)
    } catch {
      finish(null)
    }
  })
}

async function writeCache(key: string, value: ArrayBuffer) {
  const datasetVersion = datasetVersionFromUrl(key)
  await prepareDatasetCache(datasetVersion)
  const budget = await storageBudget()
  if (value.byteLength > budget) return
  if (!await hasCapacityFor(value.byteLength)) return
  await pruneDatasetCache(datasetVersion, budget, {
    key,
    record: { buffer: value, datasetVersion, byteLength: value.byteLength, lastAccessed: Date.now() },
  })
}

async function invalidateCache(key: string) {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>(resolve => {
    let settled = false, transaction: IDBTransaction | undefined
    const finish = () => {
      if (settled) return
      settled = true; clearTimeout(timer)
      try { transaction?.abort() } catch { /* Already complete. */ }
      database.close(); resolve()
    }
    const timer = setTimeout(finish, OPTIONAL_CACHE_PHASE_MS)
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(key)
      transaction.oncomplete = finish; transaction.onabort = finish; transaction.onerror = finish
    } catch { finish() }
  })
}

export function fetchImmutableArrayBuffer(url: string, validate?: (buffer: ArrayBuffer) => void | Promise<void>, signal?: AbortSignal) {
  // Keep the public callback single-argument: existing validators may have
  // optional numeric parameters that must never receive an AbortSignal.
  return fetchValidatedArrayBuffer(url, validate ? buffer => validate(buffer) : undefined, signal)
}

async function fetchValidatedArrayBuffer(url: string, validate?: (buffer: ArrayBuffer, signal: AbortSignal) => void | Promise<void>, signal?: AbortSignal) {
  // Callers may transfer or modify their buffer without detaching a sibling
  // consumer's result. Only active requests, not completed data, live here.
  const request = acquireRequest(url, signal)
  let validationWork: Promise<void> | undefined
  let releaseValidation: (() => void) | undefined
  try {
    const { buffer, cached } = await withSignal(request.promise, signal)
    signal?.throwIfAborted()
    releaseValidation = await validationAdmission.acquire(signal)
    signal?.throwIfAborted()
    // A callback can write to or transfer its argument. Never expose the
    // shared transport bytes used by siblings and deferred persistence.
    const owned = buffer.slice(0)
    const validation = new AbortController()
    const cancel = () => validation.abort(signal?.reason)
    const expired = () => validation.abort(new DOMException('Catalog validation exceeded 30 seconds', 'TimeoutError'))
    const deadline = performance.now() + CATALOG_VALIDATION_MS
    const timeout = setTimeout(expired, CATALOG_VALIDATION_MS)
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      if (signal?.aborted) cancel()
      validation.signal.throwIfAborted()
      validationWork = Promise.resolve().then(() => {
        validation.signal.throwIfAborted()
        return validate?.(owned, validation.signal)
      })
      await withSignal(validationWork, validation.signal)
      if (performance.now() >= deadline) expired()
      validation.signal.throwIfAborted()
      if (owned.byteLength !== buffer.byteLength) throw new Error('Catalog validation detached or resized its source buffer')
    }
    catch (error) {
      // Cancellation says nothing about the validity of a shared artifact.
      if (cached && !validation.signal.aborted) await invalidateCache(url)
      throw error
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel) }
    signal?.throwIfAborted()
    // Never persist a network payload before its caller's format validation.
    if (!cached) scheduleCacheWrite(url, buffer)
    return owned
  } finally {
    // The public promise may reject promptly on abort/timeout while a custom
    // validator still holds its owned buffer. Keep the shared acquisition lease
    // until that work actually settles; observe either outcome without a late
    // result being persisted or published to the cancelled caller.
    const release = () => { releaseValidation?.(); request.release() }
    if (validationWork) void validationWork.then(release, release)
    else release()
  }
}

async function loadImmutableArrayBuffer(url: string, signal: AbortSignal) {
  await withSignal(prepareDatasetCache(datasetVersionFromUrl(url)), signal)
  signal.throwIfAborted()
  const cached = await readCache(url, signal)
  signal.throwIfAborted()
  if (cached && cached.byteLength <= MAX_CATALOG_ARTIFACT_BYTES) return { buffer: cached, cached: true }
  if (cached) await invalidateCache(url)
  const response = await fetch(url, { signal })
  if (signal.aborted) {
    await response.body?.cancel().catch(() => undefined)
    signal.throwIfAborted()
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new CatalogHttpError(url, response.status)
  }
  if (Number(response.headers.get('content-length')) > MAX_CATALOG_ARTIFACT_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Catalog artifact exceeds ${MAX_CATALOG_ARTIFACT_BYTES} bytes`)
  }
  const buffer = response.body ? await readBoundedStream(response.body, MAX_CATALOG_ARTIFACT_BYTES, signal) : new ArrayBuffer(0)
  return { buffer, cached: false }
}

async function decodeSourceJson<T>(bytes: ArrayBuffer, signal?: AbortSignal, expectedSha256?: string): Promise<T> {
  signal?.throwIfAborted()
  if (bytes.byteLength > MAX_CATALOG_ARTIFACT_BYTES) throw new Error(`Catalog artifact exceeds ${MAX_CATALOG_ARTIFACT_BYTES} bytes`)
  if (expectedSha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid expected catalog JSON hash')
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    signal?.throwIfAborted()
    if (actual !== expectedSha256) throw new Error('Catalog JSON source SHA-256 mismatch')
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T
}

export async function fetchImmutableJson<T>(url: string, signal?: AbortSignal, expectedSha256?: string): Promise<T> {
  let parsed!: T
  await fetchValidatedArrayBuffer(url, async (buffer, validationSignal) => { parsed = await decodeSourceJson<T>(buffer, validationSignal, expectedSha256) }, signal)
  return parsed
}

export async function parseMaybeGzipJson<T>(buffer: ArrayBuffer, maximumBytes = MAX_CATALOG_ARTIFACT_BYTES, signal?: AbortSignal, expectedSha256?: string): Promise<T> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > MAX_CATALOG_ARTIFACT_BYTES) {
    throw new RangeError(`Catalog JSON byte limit must be an integer between 0 and ${MAX_CATALOG_ARTIFACT_BYTES}`)
  }
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid expected catalog JSON hash')
  if (buffer.byteLength > maximumBytes) throw new Error(`Catalog artifact exceeds ${maximumBytes} bytes`)
  const header = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2))
  const isGzip = header[0] === 0x1f && header[1] === 0x8b
  if (!isGzip) return decodeSourceJson<T>(buffer, signal, expectedSha256)
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support streamed gzip dataset delivery.')
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  const decompressed = await readBoundedStream(stream, maximumBytes, signal)
  return decodeSourceJson<T>(decompressed, signal, expectedSha256)
}

export async function fetchImmutableGzipJson<T>(url: string, signal?: AbortSignal, expectedSha256?: string): Promise<T> {
  let parsed!: T
  await fetchValidatedArrayBuffer(url, async (buffer, validationSignal) => { parsed = await parseMaybeGzipJson<T>(buffer, MAX_CATALOG_ARTIFACT_BYTES, validationSignal, expectedSha256) }, signal)
  return parsed
}
