/// <reference lib="webworker" />
import { loadAsteroidSearchLocators } from '../lib/catalogLoader'
import { requireCatalogAccess } from '../lib/productAccess'
import { planCatalogStream, streamCatalogPoints } from '../lib/catalogStreaming'
import { createCatalogTransferWindow } from '../lib/catalogTransferWindow'
import type { CatalogStreamRequest, CatalogStreamResponse } from './catalog-stream.protocol'

const scope = self as DedicatedWorkerGlobalScope
let controller: AbortController | null = null
let transfers: ReturnType<typeof createCatalogTransferWindow> | null = null

scope.onmessage = (event: MessageEvent<CatalogStreamRequest>) => {
  const request = event.data
  if (request.type === 'cancel') { controller?.abort(); return }
  if (request.type === 'ack') {
    transfers?.acknowledge(request.tileId)
    return
  }
  if (controller) return // One immutable request owns each worker.
  controller = new AbortController()
  const active = controller
  const window = createCatalogTransferWindow(active.signal)
  transfers = window
  void (async () => {
    try {
      requireCatalogAccess('scan')
      if (!planCatalogStream(request.manifest, request.requestedRows, request.budgetBytes).capacity) throw new Error('The catalog index exceeds the available streaming budget')
      const candidateLocators = request.filters.query.trim()
        ? await loadAsteroidSearchLocators(request.filters.query, request.manifest, active.signal)
        : undefined
      const result = await streamCatalogPoints({
        ...request, candidateLocators: candidateLocators ?? undefined, signal: active.signal,
        onTile: tile => window.publish(tileId => {
          scope.postMessage({ type: 'tile', tileId, ...tile } satisfies CatalogStreamResponse, [tile.positions.buffer, tile.appearance.buffer])
        }),
      })
      await window.drain()
      scope.postMessage({ type: 'done', ...result } satisfies CatalogStreamResponse)
    } catch (error) {
      scope.postMessage(active.signal.aborted ? { type: 'cancelled' } : {
        type: 'error', error: error instanceof Error ? error.message : String(error),
      } satisfies CatalogStreamResponse)
    } finally { window.dispose(); transfers = null }
  })()
}

export {}
