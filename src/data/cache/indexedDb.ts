const DATABASE_NAME = 'solar-atlas-data-v1'
const DATABASE_VERSION = 2
const STORE_NAME = 'immutable-responses'
const MAX_DATASET_CACHE_BYTES = 256 * 1024 * 1024
const MIN_FREE_STORAGE_BYTES = 16 * 1024 * 1024
const PRUNE_INTERVAL = 32

type CacheRecord = {
  buffer: ArrayBuffer
  datasetVersion: string
  byteLength: number
  lastAccessed: number
}

let preparedVersion: string | null = null
let preparePromise: Promise<void> | null = null
let writesSincePrune = 0
const inFlight = new Map<string, Promise<{ buffer: ArrayBuffer; cached: boolean }>>()

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

async function pruneDatasetCache(activeVersion: string, maximumBytes: number) {
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
          let retainedBytes = 0
          for (const entry of activeEntries) {
            if (retainedBytes + entry.byteLength > maximumBytes) store.delete(entry.key)
            else retainedBytes += entry.byteLength
          }
          return
        }
        if (!isCacheRecord(cursor.value) || isObsoleteDatasetVersion(cursor.value.datasetVersion, activeVersion)) {
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
  if (value.byteLength > await storageBudget()) return
  if (!await hasCapacityFor(value.byteLength)) return
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
      const record: CacheRecord = {
        buffer: value,
        datasetVersion,
        byteLength: value.byteLength,
        lastAccessed: Date.now(),
      }
      transaction.objectStore(STORE_NAME).put(record, key)
      transaction.oncomplete = finish
      transaction.onerror = finish
      transaction.onabort = finish
    } catch {
      finish()
    }
  })
  writesSincePrune += 1
  if (writesSincePrune >= PRUNE_INTERVAL) {
    writesSincePrune = 0
    const budget = await storageBudget()
    await pruneDatasetCache(datasetVersion, budget)
  }
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

export async function fetchImmutableArrayBuffer(url: string, validate?: (buffer: ArrayBuffer) => void | Promise<void>) {
  let pending = inFlight.get(url)
  if (!pending) {
    pending = loadImmutableArrayBuffer(url)
    inFlight.set(url, pending)
  }
  try {
    // Callers may transfer or modify their buffer without detaching a sibling
    // consumer's result. Only active requests, not completed data, live here.
    const { buffer, cached } = await pending
    try { await validate?.(buffer) }
    catch (error) {
      if (cached) await invalidateCache(url)
      throw error
    }
    // Never persist a network payload before its caller's format validation.
    if (!cached) void writeCache(url, buffer).catch(() => undefined)
    return buffer.slice(0)
  } finally {
    if (inFlight.get(url) === pending) inFlight.delete(url)
  }
}

async function loadImmutableArrayBuffer(url: string) {
  await prepareDatasetCache(datasetVersionFromUrl(url))
  const cached = await readCache(url)
  if (cached) return { buffer: cached, cached: true }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  const buffer = await response.arrayBuffer()
  return { buffer, cached: false }
}

export async function fetchImmutableJson<T>(url: string): Promise<T> {
  let parsed!: T
  await fetchImmutableArrayBuffer(url, buffer => { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as T })
  return parsed
}

export async function parseMaybeGzipJson<T>(buffer: ArrayBuffer): Promise<T> {
  const header = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2))
  const isGzip = header[0] === 0x1f && header[1] === 0x8b
  if (!isGzip) return JSON.parse(new TextDecoder().decode(buffer)) as T
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support streamed gzip dataset delivery.')
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  const decompressed = await new Response(stream).arrayBuffer()
  return JSON.parse(new TextDecoder().decode(decompressed)) as T
}

export async function fetchImmutableGzipJson<T>(url: string): Promise<T> {
  let parsed!: T
  await fetchImmutableArrayBuffer(url, async buffer => { parsed = await parseMaybeGzipJson<T>(buffer) })
  return parsed
}
