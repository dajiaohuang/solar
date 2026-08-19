import type {
  AsteroidManifest,
  AsteroidRecord,
  CatalogFilters,
  CatalogScanWorkerRequest,
  CatalogScanWorkerResponse,
} from '../types'

let nextRequestId = 0

export function scanAsteroidCatalog(params: {
  manifest: AsteroidManifest
  filters: CatalogFilters
  sampleLimit: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}) {
  return new Promise<{ total: number; records: AsteroidRecord[] }>((resolve, reject) => {
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
      if (event.data.requestId !== requestId) return
      if (event.data.type === 'progress') params.onProgress?.(event.data.progress ?? 0)
      if (event.data.type === 'result') {
        params.signal?.removeEventListener('abort', abort)
        worker.terminate()
        resolve({ total: event.data.total ?? 0, records: event.data.records ?? [] })
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
      type: 'scan', requestId, manifest: params.manifest, filters: params.filters, sampleLimit: params.sampleLimit,
    }
    worker.postMessage(request)
  })
}
