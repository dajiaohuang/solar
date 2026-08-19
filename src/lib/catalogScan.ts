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

type PendingScan = {
  manifest: AsteroidManifest
  scanKey: string
  onProgress?: (progress: number) => void
  resolve: (result: { scanKey: string; total: number; records: AsteroidRecord[] }) => void
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
      const hydrate = event.data.locators
        ? loadAsteroidRecordsByLocators(pending.manifest, event.data.locators)
        : Promise.resolve(event.data.records ?? [])
      void hydrate.then((records) => pending.resolve({
        scanKey: pending.scanKey,
        total: event.data.total ?? 0,
        records,
      })).catch((error: unknown) => pending.reject(error instanceof Error ? error : new Error(String(error))))
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

  return new Promise<{ scanKey: string; total: number; records: AsteroidRecord[] }>((resolve, reject) => {
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
