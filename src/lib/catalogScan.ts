import { loadAsteroidRecordsByLocators, loadAsteroidSearchLocators } from './catalogLoader'
import { requireCatalogAccess } from './productAccess'
import { catalogBatch } from '../data/cache/sharedCatalogCache'
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
type HydrationQueue = { manifestIdentity: string; remaining: Uint32Array; controller: AbortController; loading: boolean }
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

function recordsForLocatorPage(sampleLocators: Uint32Array, pageLocators: Uint32Array, records: AsteroidRecord[]) {
  if (sampleLocators.length !== records.length * 2) throw new Error('Catalog scan records do not match their source locators')
  const byLocator = new Map<string, AsteroidRecord>()
  for (let index = 0; index < records.length; index += 1) {
    const chunkIndex = sampleLocators[index * 2], rowIndex = sampleLocators[index * 2 + 1]
    const record = records[index]
    if (record.chunkIndex !== chunkIndex || record.rowIndex !== rowIndex) throw new Error('Catalog scan record identity differs from its source locator')
    const key = `${chunkIndex}:${rowIndex}`
    if (byLocator.has(key)) throw new Error('Catalog scan contains a duplicate source locator')
    byLocator.set(key, record)
  }
  const page: AsteroidRecord[] = []
  for (let index = 0; index < pageLocators.length; index += 2) {
    const record = byLocator.get(`${pageLocators[index]}:${pageLocators[index + 1]}`)
    if (!record) throw new Error('Catalog result page does not match its scanned records')
    page.push(record)
  }
  return page
}

type PendingScan = {
  controller: AbortController
  hydrating?: boolean
  manifest: AsteroidManifest
  scanKey: string
  onProgress?: (progress: number) => void
  resolve: (result: { scanKey: string; total: number; records: AsteroidRecord[]; hasMore: boolean }) => void
  reject: (error: Error) => void
}

const pendingScans = new Map<number, PendingScan>()

export function createCatalogScanKey(source: string | AsteroidManifest, filters: CatalogFilters, sampleLimit: number) {
  // Legacy callers may still supply a version string. Production scans supply
  // their complete manifest so same-name releases cannot share retained results.
  const datasetVersion = typeof source === 'string' ? source : source.version
  return JSON.stringify({ datasetVersion, ...(typeof source === 'string' ? {} : { manifest: source }), filters, sampleLimit })
}

function ensureCatalogWorker() {
  if (catalogWorker) return catalogWorker
  const worker = new Worker(new URL('../workers/catalog-scan.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<CatalogScanWorkerResponse>) => {
    const pending = pendingScans.get(event.data.requestId)
    if (!pending || event.data.scanKey !== pending.scanKey) return
    if (event.data.type === 'progress') pending.onProgress?.(event.data.progress ?? 0)
    if (event.data.type === 'result') {
      if (pending.hydrating) return
      pending.hydrating = true
      const page = event.data.locators ? takeCatalogLocatorPage(event.data.locators) : null
      let transferredPage: AsteroidRecord[] | undefined
      if (page && event.data.records) {
        try { transferredPage = recordsForLocatorPage(event.data.locators!, page.locators, event.data.records) }
        catch (error) {
          pending.reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      const hydrate = page
        ? transferredPage ? Promise.resolve(transferredPage)
          : loadAsteroidRecordsByLocators(pending.manifest, page.locators, pending.controller.signal)
        : Promise.resolve(event.data.records ?? [])
      void hydrate.then((records) => {
        pending.controller.signal.throwIfAborted()
        if (page?.remaining.length) {
          hydrationQueues.set(pending.scanKey, { manifestIdentity: JSON.stringify(pending.manifest), remaining: page.remaining,
            controller: pending.controller, loading: false })
        }
        pending.resolve({ scanKey: pending.scanKey, total: event.data.total ?? 0,
          records, hasMore: Boolean(page?.remaining.length) })
      }).catch((error: unknown) => {
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
  for (const key of hydrationQueues.keys()) discardCatalogScanPages(key)
  catalogWorker?.terminate()
  catalogWorker = null
}

export function discardCatalogScanPages(scanKey: string) {
  hydrationQueues.get(scanKey)?.controller.abort()
  hydrationQueues.delete(scanKey)
}

export async function loadNextCatalogScanPage(scanKey: string, manifest: AsteroidManifest, signal?: AbortSignal) {
  requireCatalogAccess('scan')
  manifest = structuredClone(manifest)
  const queue = hydrationQueues.get(scanKey)
  if (!queue) return { records: [], hasMore: false }
  if (queue.manifestIdentity !== JSON.stringify(manifest)) throw new Error('Catalog page manifest differs from its scan snapshot')
  if (queue.loading) throw new Error('Catalog page is already loading')
  queue.loading = true
  const page = takeCatalogLocatorPage(queue.remaining)
  try {
    const records = await catalogBatch([queue.controller.signal, ...(signal ? [signal] : [])],
      batchSignal => loadAsteroidRecordsByLocators(manifest, page.locators, batchSignal))
    if (hydrationQueues.get(scanKey) !== queue) throw new DOMException('Catalog page was replaced', 'AbortError')
    queue.remaining = page.remaining
    if (!page.remaining.length) hydrationQueues.delete(scanKey)
    return { records, hasMore: page.remaining.length > 0 }
  } finally { queue.loading = false }
}

export async function scanAsteroidCatalog(params: {
  manifest: AsteroidManifest
  filters: CatalogFilters
  sampleLimit: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}) {
  params = { ...params, manifest: structuredClone(params.manifest), filters: structuredClone(params.filters) }
  const scanKey = createCatalogScanKey(params.manifest, params.filters, params.sampleLimit)
  requireCatalogAccess('scan')
  if (params.signal?.aborted) throw new DOMException('Catalog scan was cancelled', 'AbortError')
  const candidateLocators = params.filters.query.trim()
    ? await loadAsteroidSearchLocators(params.filters.query, params.manifest, params.signal)
    : null
  if (params.signal?.aborted) throw new DOMException('Catalog scan was cancelled', 'AbortError')
  const requestId = ++nextRequestId
  const worker = ensureCatalogWorker()

  discardCatalogScanPages(scanKey)
  return new Promise<{ scanKey: string; total: number; records: AsteroidRecord[]; hasMore: boolean }>((resolve, reject) => {
    const controller = new AbortController()
    const abort = () => {
      worker.postMessage({ type: 'cancel', requestId })
      pendingScans.get(requestId)?.reject(new DOMException('Catalog scan was cancelled', 'AbortError'))
    }
    params.signal?.addEventListener('abort', abort, { once: true })
    pendingScans.set(requestId, {
      controller,
      manifest: params.manifest,
      scanKey,
      onProgress: params.onProgress,
      resolve: (result) => {
        pendingScans.delete(requestId)
        params.signal?.removeEventListener('abort', abort)
        resolve(result)
      },
      reject: (error) => {
        controller.abort()
        pendingScans.delete(requestId)
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
