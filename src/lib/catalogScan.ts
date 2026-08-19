import type {
  AsteroidManifest,
  AsteroidRecord,
  CatalogFilters,
  CatalogScanWorkerRequest,
  CatalogScanWorkerResponse,
} from '../types'

let nextRequestId = 0

export function createCatalogScanKey(
  datasetVersion: string,
  filters: CatalogFilters,
  sampleLimit: number,
) {
  return JSON.stringify({ datasetVersion, filters, sampleLimit })
}

export function scanAsteroidCatalog(params: {
  manifest: AsteroidManifest
  filters: CatalogFilters
  sampleLimit: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}) {
  const scanKey = createCatalogScanKey(params.manifest.version, params.filters, params.sampleLimit)
  return new Promise<{ scanKey: string; total: number; records: AsteroidRecord[] }>((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new DOMException('Catalog scan was cancelled', 'AbortError'))
      return
    }
    const requestId = nextRequestId + 1
    nextRequestId = requestId
    const worker = new Worker(new URL('../workers/catalog-scan.worker.ts', import.meta.url), { type: 'module' })
    const abort = () => {
      worker.terminate()
      reject(new DOMException('Catalog scan was cancelled', 'AbortError'))
    }
    params.signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<CatalogScanWorkerResponse>) => {
      if (event.data.requestId !== requestId || event.data.scanKey !== scanKey) return
      if (event.data.type === 'progress') params.onProgress?.(event.data.progress ?? 0)
      if (event.data.type === 'result') {
        params.signal?.removeEventListener('abort', abort)
        worker.terminate()
        resolve({ scanKey, total: event.data.total ?? 0, records: event.data.records ?? [] })
      }
      if (event.data.type === 'error') {
        params.signal?.removeEventListener('abort', abort)
        worker.terminate()
        reject(new Error(event.data.error ?? 'Catalog scan failed'))
      }
    }
    worker.onerror = (event) => {
      params.signal?.removeEventListener('abort', abort)
      worker.terminate()
      reject(new Error(event.message || 'Catalog scan failed'))
    }
    const request: CatalogScanWorkerRequest = {
      type: 'scan', requestId, scanKey, manifest: params.manifest, filters: params.filters, sampleLimit: params.sampleLimit,
    }
    worker.postMessage(request)
  })
}
