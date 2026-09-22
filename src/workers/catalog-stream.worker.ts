/// <reference lib="webworker" />
import { loadAsteroidSearchLocators } from '../lib/catalogLoader'
import { requireCatalogAccess } from '../lib/productAccess'
import { planCatalogStream, streamCatalogPoints } from '../lib/catalogStreaming'
import type { CatalogStreamRequest, CatalogStreamResponse } from './catalog-stream.protocol'

const scope = self as DedicatedWorkerGlobalScope
let controller: AbortController | null = null
let acknowledgement: { tileId: number; resolve: () => void } | null = null

scope.onmessage = (event: MessageEvent<CatalogStreamRequest>) => {
  const request = event.data
  if (request.type === 'cancel') { controller?.abort(); return }
  if (request.type === 'ack') {
    if (acknowledgement?.tileId === request.tileId) acknowledgement.resolve()
    return
  }
  if (controller) return // One immutable request owns each worker.
  controller = new AbortController()
  const active = controller
  void (async () => {
    try {
      requireCatalogAccess('scan')
      if (!planCatalogStream(request.manifest, request.requestedRows, request.budgetBytes).capacity) throw new Error('The catalog index exceeds the available streaming budget')
      const candidateLocators = request.filters.query.trim()
        ? await loadAsteroidSearchLocators(request.filters.query, request.manifest, active.signal)
        : undefined
      let nextTile = 0
      const result = await streamCatalogPoints({
        ...request, candidateLocators: candidateLocators ?? undefined, signal: active.signal,
        onTile: tile => new Promise<void>((resolve, reject) => {
          const tileId = ++nextTile
          const abort = () => { acknowledgement = null; reject(active.signal.reason) }
          acknowledgement = { tileId, resolve: () => {
            active.signal.removeEventListener('abort', abort)
            acknowledgement = null
            resolve()
          } }
          active.signal.addEventListener('abort', abort, { once: true })
          if (active.signal.aborted) { abort(); return }
          scope.postMessage({ type: 'tile', tileId, ...tile } satisfies CatalogStreamResponse, [tile.positions.buffer, tile.appearance.buffer])
        }),
      })
      scope.postMessage({ type: 'done', ...result } satisfies CatalogStreamResponse)
    } catch (error) {
      scope.postMessage(active.signal.aborted ? { type: 'cancelled' } : {
        type: 'error', error: error instanceof Error ? error.message : String(error),
      } satisfies CatalogStreamResponse)
    }
  })()
}

export {}
