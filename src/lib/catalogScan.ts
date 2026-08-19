import { loadAsteroidRecordsByLocators, loadAsteroidSearchLocators } from './catalogLoader'
import type {
  AsteroidManifest,
  AsteroidRecord,
  CatalogFilters,
  CatalogScanWorkerRequest,
  CatalogScanWorkerResponse,
} from '../types'

let nextRequestId = 0
let catalogWorker: Worker | null = null
export const EXACT_CATALOG_LOCATOR_LIMIT = 2_000
export const EXACT_HYDRATION_RECORD_LIMIT = 480
export const EXACT_HYDRATION_CHUNK_LIMIT = 32

type LocatorPage = { locators: Uint32Array; remaining: Uint32Array }
type HydrationQueue = { manifestVersion: string; remaining: Uint32Array }
const hydrationQueues = new Map<string, HydrationQueue>()

export function takeCatalogLocatorPage(
  locators: Uint32Array,
  recordLimit = EXACT_HYDRATION_RECORD_LIMIT,
  chunkLimit = EXACT_HYDRATION_CHUNK_LIMIT,
): LocatorPage {
  if (locators.length % 2 !== 0) throw new Error('Catalog locator array must contain chunk/row pairs')
  const selectedChunks = new Set<number>()
  for (let index = 0; index < locators.length && selectedChunks.size < chunkLimit; index += 2) {
    selectedChunks.add(locators[index])
  }
  const selected: number[] = []
  const remaining: number[] = []
  for (let index = 0; index < locators.length; index += 2) {
    const pair = [locators[index], locators[index + 1]]
    if (selected.length / 2 < recordLimit && selectedChunks.has(pair[0])) selected.push(...pair)
    else remaining.push(...pair)
  }
  return { locators: Uint32Array.from(selected), remaining: Uint32Array.from(remaining) }
}

type PendingScan = {
  manifest: AsteroidManifest
  scanKey: string
  onProgress?: (progress: number) => void
  resolve: (result: { scanKey: string; total: number; records: AsteroidRecord[]; hasMore: boolean }) => void
  reject: (error: Error) => void
}

const pendingScans = new Map<number, PendingScan>()

export function createCatalogScanKey(datasetVersion: string, filters: CatalogFilters, sampleLimit: number) {
  return JSON.stringify({ datasetVersion, filters, sampleLimit })
}

function ensureCatalogWorker() {
  if (catalogWorker) return catalogWorker
  const worker = new Worker(new URL('../workers/catalog-scan.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<CatalogScanWorkerResponse>) => {
    const pending = pendingScans.get(event.data.requestId)
    if (!pending || event.data.scanKey !== pending.scanKey) return
    if (event.data.type === 'progress') pending.onProgress?.(event.data.progress ?? 0)
    if (event.data.type === 'result') {
      pendingScans.delete(event.data.requestId)
      const page = event.data.locators ? takeCatalogLocatorPage(event.data.locators) : null
      if (page?.remaining.length) {
        hydrationQueues.set(pending.scanKey, { manifestVersion: pending.manifest.version, remaining: page.remaining })
      } else {
        hydrationQueues.delete(pending.scanKey)
      }
      const hydrate = page
        ? loadAsteroidRecordsByLocators(pending.manifest, page.locators)
        : Promise.resolve(event.data.records ?? [])
      void hydrate.then((records) => pending.resolve({
        scanKey: pending.scanKey,
        total: event.data.total ?? 0,
        records,
        hasMore: Boolean(page?.remaining.length),
      })).catch((error: unknown) => {
        hydrationQueues.delete(pending.scanKey)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      })
    }
    if (event.data.type === 'error') {
      pendingScans.delete(event.data.requestId)
      pending.reject(new Error(event.data.error ?? 'Catalog scan failed'))
    }
  }
  worker.onerror = (event) => {
    for (const pending of pendingScans.values()) pending.reject(new Error(event.message || 'Catalog scan failed'))
    pendingScans.clear()
    worker.terminate()
    if (catalogWorker === worker) catalogWorker = null
  }
  catalogWorker = worker
  return worker
}

export function resetCatalogScanWorker() {
  const error = new Error('Catalog worker was reset')
  for (const pending of pendingScans.values()) pending.reject(error)
  pendingScans.clear()
  hydrationQueues.clear()
  catalogWorker?.terminate()
  catalogWorker = null
}

export async function loadNextCatalogScanPage(scanKey: string, manifest: AsteroidManifest) {
  const queue = hydrationQueues.get(scanKey)
  if (!queue || queue.manifestVersion !== manifest.version) return { records: [], hasMore: false }
  const page = takeCatalogLocatorPage(queue.remaining)
  const records = await loadAsteroidRecordsByLocators(manifest, page.locators)
  if (page.remaining.length) hydrationQueues.set(scanKey, { ...queue, remaining: page.remaining })
  else hydrationQueues.delete(scanKey)
  return { records, hasMore: page.remaining.length > 0 }
}

export async function scanAsteroidCatalog(params: {
  manifest: AsteroidManifest
  filters: CatalogFilters
  sampleLimit: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}) {
  const scanKey = createCatalogScanKey(params.manifest.version, params.filters, params.sampleLimit)
  if (params.signal?.aborted) throw new DOMException('Catalog scan was cancelled', 'AbortError')
  const candidateLocators = params.filters.query.trim()
    ? await loadAsteroidSearchLocators(params.filters.query, params.manifest)
    : null
  if (params.signal?.aborted) throw new DOMException('Catalog scan was cancelled', 'AbortError')
  const requestId = ++nextRequestId
  const worker = ensureCatalogWorker()

  hydrationQueues.delete(scanKey)
  return new Promise<{ scanKey: string; total: number; records: AsteroidRecord[]; hasMore: boolean }>((resolve, reject) => {
    const abort = () => {
      worker.postMessage({ type: 'cancel', requestId })
      pendingScans.delete(requestId)
      reject(new DOMException('Catalog scan was cancelled', 'AbortError'))
    }
    params.signal?.addEventListener('abort', abort, { once: true })
    pendingScans.set(requestId, {
      manifest: params.manifest,
      scanKey,
      onProgress: params.onProgress,
      resolve: (result) => {
        params.signal?.removeEventListener('abort', abort)
        resolve(result)
      },
      reject: (error) => {
        params.signal?.removeEventListener('abort', abort)
        reject(error)
      },
    })
    const request: CatalogScanWorkerRequest = {
      type: 'scan', requestId, scanKey, manifest: params.manifest,
      filters: params.filters, sampleLimit: params.sampleLimit,
      ...(candidateLocators ? { candidateLocators } : {}),
    }
    worker.postMessage(request, candidateLocators ? [candidateLocators.buffer] : [])
  })
}
