const DATABASE_NAME = 'solar-atlas-data-v1'
const STORE_NAME = 'immutable-responses'

function openDatabase() {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (!('indexedDB' in globalThis)) {
      resolve(null)
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}
async function readCache(key: string) {
  const database = await openDatabase()
  if (!database) return null
  return new Promise<ArrayBuffer | null>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? request.result : null)
    request.onerror = () => resolve(null)
    transaction.oncomplete = () => database.close()
  })
}

async function writeCache(key: string, value: ArrayBuffer) {
  const database = await openDatabase()
  if (!database) return
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(value, key)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); resolve() }
  })
}

export async function fetchImmutableArrayBuffer(url: string) {
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
