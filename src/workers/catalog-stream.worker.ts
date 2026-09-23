/// <reference lib="webworker" />
import { loadAsteroidSearchLocators } from '../lib/catalogLoader'
import { requireCatalogAccess } from '../lib/productAccess'
import { planCatalogStream, streamCatalogPoints } from '../lib/catalogStreaming'
import { createCatalogTransferWindow } from '../lib/catalogTransferWindow'
import { selectCatalogSpatialPoints } from '../lib/catalogSpatialSelection'
import type { CatalogStreamRequest, CatalogStreamResponse } from './catalog-stream.protocol'

const scope = self as DedicatedWorkerGlobalScope
let controller: AbortController | null = null
let transfers: ReturnType<typeof createCatalogTransferWindow> | null = null
let spatialPositions = new Float32Array(), availablePoints = 0
let pendingView: Extract<CatalogStreamRequest, { type: 'view' }> | null = null
let selecting = false, viewGeneration = 0
const channel = new MessageChannel(), continuations: (() => void)[] = []
channel.port1.onmessage = () => continuations.shift()?.()
const yieldToMessages = () => new Promise<void>(resolve => { continuations.push(resolve); channel.port2.postMessage(null) })

async function selectViews() {
  if (selecting) return
  selecting = true
  try {
    while (pendingView) {
      const request = pendingView, generation = viewGeneration
      pendingView = null
      if (request.count > availablePoints) throw new Error('Spatial view exceeds computed source rows')
      const result = await selectCatalogSpatialPoints(spatialPositions, request.count, request.view, () => generation !== viewGeneration, yieldToMessages)
      if (result && generation === viewGeneration) scope.postMessage({ type: 'selection', requestId: request.requestId, count: request.count, indices: result.indices, visible: result.visible } satisfies CatalogStreamResponse, [result.indices.buffer])
    }
  } catch (error) {
    scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) } satisfies CatalogStreamResponse)
  } finally { selecting = false }
}

scope.onmessage = (event: MessageEvent<CatalogStreamRequest>) => {
  const request = event.data
  if (request.type === 'view') { viewGeneration++; pendingView = request; void selectViews(); return }
  if (request.type === 'cancel') { controller?.abort(); viewGeneration++; pendingView = null; return }
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
      const plan = planCatalogStream(request.manifest, request.requestedRows, request.budgetBytes)
      if (!plan.capacity) throw new Error('The catalog index exceeds the available streaming budget')
      spatialPositions = new Float32Array(plan.capacity * 2)
      const candidateLocators = request.filters.query.trim()
        ? await loadAsteroidSearchLocators(request.filters.query, request.manifest, active.signal)
        : undefined
      const result = await streamCatalogPoints({
        ...request, candidateLocators: candidateLocators ?? undefined, signal: active.signal,
        onTile: tile => {
          // This Float32 copy is exclusively for visual culling. Scientific
          // propagation and the transferred source snapshot remain Float64.
          spatialPositions.set(tile.positions, (tile.drawnRows - tile.positions.length / 2) * 2)
          availablePoints = tile.drawnRows
          return window.publish(tileId => {
            scope.postMessage({ type: 'tile', tileId, ...tile } satisfies CatalogStreamResponse, [tile.positions.buffer, tile.appearance.buffer])
          })
        },
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
