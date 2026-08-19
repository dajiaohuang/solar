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

export function datasetVersionFromUrl(url: string) {
  try {
    const pathname = new URL(url, globalThis.location?.href ?? 'https://solar-atlas.invalid/').pathname
    const match = pathname.match(/\/data\/asteroids\/releases\/([^/]+)\//)
    return match ? decodeURIComponent(match[1]) : 'legacy'
  } catch {
    return 'legacy'
  }
}

function isCacheRecord(value: unknown): value is CacheRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CacheRecord>
  return candidate.buffer instanceof ArrayBuffer &&
    typeof candidate.datasetVersion === 'string' &&
    typeof candidate.byteLength === 'number' &&
    typeof candidate.lastAccessed === 'number'
}

function openDatabase() {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (!('indexedDB' in globalThis)) {
      resolve(null)
      return
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
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
      const activeEntries: Array<{ key: IDBValidKey; record: CacheRecord }> = []
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) {
          activeEntries.sort((left, right) => right.record.lastAccessed - left.record.lastAccessed)
          let retainedBytes = 0
          for (const entry of activeEntries) {
            retainedBytes += entry.record.byteLength
            if (retainedBytes > maximumBytes) store.delete(entry.key)
          }
          return
        }
        if (!isCacheRecord(cursor.value) || cursor.value.datasetVersion !== activeVersion) {
          cursor.delete()
        } else {
          activeEntries.push({ key: cursor.primaryKey, record: cursor.value })
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
    const finish = (value: ArrayBuffer | null) => {
      if (settled) return
      settled = true
      database.close()
      resolve(value)
    }
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => {
        if (request.result instanceof ArrayBuffer) finish(request.result)
        else finish(isCacheRecord(request.result) ? request.result.buffer : null)
      }
      request.onerror = () => finish(null)
      transaction.onabort = () => finish(null)
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

export async function fetchImmutableArrayBuffer(url: string) {
  await prepareDatasetCache(datasetVersionFromUrl(url))
  const cached = await readCache(url)
  if (cached) return cached
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  const buffer = await response.arrayBuffer()
  void writeCache(url, buffer.slice(0))
  return buffer
}

export async function fetchImmutableJson<T>(url: string): Promise<T> {
  const buffer = await fetchImmutableArrayBuffer(url)
  return JSON.parse(new TextDecoder().decode(buffer)) as T
}
