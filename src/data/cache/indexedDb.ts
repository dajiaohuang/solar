import { MAX_CATALOG_ARTIFACT_BYTES, readBoundedStream } from './boundedStream'

const DATABASE_NAME = 'solar-atlas-data-v1'
const DATABASE_VERSION = 2
const STORE_NAME = 'immutable-responses'
const MAX_DATASET_CACHE_BYTES = 256 * 1024 * 1024
const MIN_FREE_STORAGE_BYTES = 16 * 1024 * 1024

type CacheRecord = {
  buffer: ArrayBuffer
  datasetVersion: string
  byteLength: number
  lastAccessed: number
}

let preparedVersion: string | null = null
let preparePromise: Promise<void> | null = null
type Payload = { buffer: ArrayBuffer; cached: boolean }
type SharedRequest = { promise: Promise<Payload>; controller: AbortController; consumers: number; settled: boolean }
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
    const created: SharedRequest = { controller, consumers: 0, settled: false, promise: loadImmutableArrayBuffer(url, controller.signal).finally(() => {
      created.settled = true
      if (!created.consumers && inFlight.get(url) === created) inFlight.delete(url)
    }) }
    pending = created
    inFlight.set(url, pending)
  }
  pending.consumers++
  const entry = pending
  return { promise: entry.promise, release: () => {
    entry.consumers--
    if (entry.consumers) return
    if (inFlight.get(url) === entry) inFlight.delete(url)
    if (!entry.settled) entry.controller.abort()
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
    const timeout = setTimeout(() => finish(null), 1500)
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

async function storageBudget() {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.()
    if (!estimate?.quota) return MAX_DATASET_CACHE_BYTES
    return Math.min(MAX_DATASET_CACHE_BYTES, Math.floor(estimate.quota * 0.25))
  } catch {
    return MAX_DATASET_CACHE_BYTES
  }
}

async function hasCapacityFor(byteLength: number) {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.()
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
    const finish = () => {
      if (settled) return
      settled = true
      database.close()
      resolve()
    }
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const activeEntries: Array<{ key: IDBValidKey; byteLength: number; lastAccessed: number }> = []
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
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

async function readCache(key: string) {
  const database = await openDatabase()
  if (!database) return null
  return new Promise<ArrayBuffer | null>((resolve) => {
    let settled = false
    let cached: ArrayBuffer | null = null
    const finish = (value: ArrayBuffer | null) => {
      if (settled) return
      settled = true
      database.close()
      resolve(value)
    }
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => {
        if (request.result instanceof ArrayBuffer) {
          cached = request.result
          store.put({
            buffer: request.result,
            datasetVersion: datasetVersionFromUrl(key),
            byteLength: request.result.byteLength,
            lastAccessed: Date.now(),
          } satisfies CacheRecord, key)
        } else if (isCacheRecord(request.result)) {
          cached = request.result.buffer
          store.put({ ...request.result, lastAccessed: Date.now() } satisfies CacheRecord, key)
        }
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
    const finish = () => { database.close(); resolve() }
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(key)
      transaction.oncomplete = finish; transaction.onabort = finish; transaction.onerror = finish
    } catch { finish() }
  })
}

export async function fetchImmutableArrayBuffer(url: string, validate?: (buffer: ArrayBuffer) => void | Promise<void>, signal?: AbortSignal) {
  // Callers may transfer or modify their buffer without detaching a sibling
  // consumer's result. Only active requests, not completed data, live here.
  const request = acquireRequest(url, signal)
  try {
    const { buffer, cached } = await withSignal(request.promise, signal)
    signal?.throwIfAborted()
    try { await withSignal(Promise.resolve(validate?.(buffer)), signal) }
    catch (error) {
      // Cancellation says nothing about the validity of a shared artifact.
      if (cached && !signal?.aborted) await invalidateCache(url)
      throw error
    }
    signal?.throwIfAborted()
    // Never persist a network payload before its caller's format validation.
    if (!cached) void writeCache(url, buffer).catch(() => undefined)
    return buffer.slice(0)
  } finally { request.release() }
}

async function loadImmutableArrayBuffer(url: string, signal: AbortSignal) {
  await prepareDatasetCache(datasetVersionFromUrl(url))
  signal.throwIfAborted()
  const cached = await readCache(url)
  signal.throwIfAborted()
  if (cached && cached.byteLength <= MAX_CATALOG_ARTIFACT_BYTES) return { buffer: cached, cached: true }
  if (cached) await invalidateCache(url)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  if (Number(response.headers.get('content-length')) > MAX_CATALOG_ARTIFACT_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw new Error(`Catalog artifact exceeds ${MAX_CATALOG_ARTIFACT_BYTES} bytes`)
  }
  const buffer = response.body ? await readBoundedStream(response.body, MAX_CATALOG_ARTIFACT_BYTES, signal) : new ArrayBuffer(0)
  return { buffer, cached: false }
}

export async function fetchImmutableJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let parsed!: T
  await fetchImmutableArrayBuffer(url, buffer => { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as T }, signal)
  return parsed
}

export async function parseMaybeGzipJson<T>(buffer: ArrayBuffer, maximumBytes = MAX_CATALOG_ARTIFACT_BYTES, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (buffer.byteLength > maximumBytes) throw new Error(`Catalog artifact exceeds ${maximumBytes} bytes`)
  const header = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2))
  const isGzip = header[0] === 0x1f && header[1] === 0x8b
  if (!isGzip) return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as T
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support streamed gzip dataset delivery.')
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  const decompressed = await readBoundedStream(stream, maximumBytes, signal)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decompressed)) as T
}

export async function fetchImmutableGzipJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let parsed!: T
  await fetchImmutableArrayBuffer(url, async buffer => { parsed = await parseMaybeGzipJson<T>(buffer, MAX_CATALOG_ARTIFACT_BYTES, signal) }, signal)
  return parsed
}
