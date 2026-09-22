/// <reference lib="webworker" />

import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from './catalog-points.protocol'
import { CATALOG_ELEMENT_STRIDE, PREPARED_CATALOG_STRIDE, prepareCatalogElementRange, prepareCatalogElements, propagatePreparedCatalogPositions, type PreparedCatalogElements } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'

const workerScope = self as DedicatedWorkerGlobalScope
let prepared: PreparedCatalogElements = prepareCatalogElements(new Float64Array())
let generation = 0, initializing = false
const CHUNK_ROWS = 20_000
let channel: MessageChannel | null = null
const continuations: (() => void)[] = []
function yieldToMessages() {
  if (!channel) { channel = new MessageChannel(); channel.port1.onmessage = () => continuations.shift()?.() }
  return new Promise<void>(resolve => { continuations.push(resolve); channel!.port2.postMessage(null) })
}

async function initialize(request: Extract<CatalogPointWorkerRequest, { type: 'initialize' }>, token: number) {
  initializing = true
  prepared = prepareCatalogElements(new Float64Array())
  const { elements } = request
  if (elements.length % CATALOG_ELEMENT_STRIDE !== 0) throw new Error('Catalog element buffer has an invalid stride')
  const count = elements.length / CATALOG_ELEMENT_STRIDE
  const next = { data: new Float64Array(count * PREPARED_CATALOG_STRIDE), count }
  for (let start = 0; start < count; start += CHUNK_ROWS) {
    prepareCatalogElementRange(elements, next, start, Math.min(count, start + CHUNK_ROWS))
    if (start + CHUNK_ROWS < count) { await yieldToMessages(); if (token !== generation) return }
  }
  if (token !== generation) return
  prepared = next; initializing = false
  workerScope.postMessage({ type: 'initialized', requestId: request.requestId } satisfies CatalogPointWorkerResponse)
}

async function compute(request: Extract<CatalogPointWorkerRequest, { type: 'compute' }>, token: number) {
  if (initializing) throw new Error('Catalog elements are still initializing')
  const { julianDay, requestId, mode } = request
  // The scene clock is UTC; MPCORB's unchanged source epochs are TT. Convert
  // once per job, not once per record. Pre-1972 remains exploratory fallback,
  // matching the single-body resolver's explicit historical limitation.
  const epochTt = julianDay >= 2441317.5 ? utcJulianDayToTt(julianDay) : julianDay
  // Keep the shared heliocentric snapshot in Float64. Each reference pane
  // subtracts its own origin before rounding coordinates for GPU upload.
  const source = prepared, positions = new Float64Array(source.count * (mode === '2d' ? 2 : 3))
  // Empty sets still validate mode and epoch.
  propagatePreparedCatalogPositions(source, epochTt, mode, positions, 0, 0)
  for (let start = 0; start < source.count; start += CHUNK_ROWS) {
    const end = Math.min(source.count, start + CHUNK_ROWS)
    propagatePreparedCatalogPositions(source, epochTt, mode, positions, start, end)
    if (end < source.count) {
      workerScope.postMessage({ type: 'progress', requestId, progress: end / source.count } satisfies CatalogPointWorkerResponse)
      await yieldToMessages()
      if (token !== generation) return
    }
  }
  const response: CatalogPointWorkerResponse = { type: 'result', requestId, progress: 1, julianDay, mode, positions }
  workerScope.postMessage(response, [positions.buffer])
}

workerScope.onmessage = async (event: MessageEvent<CatalogPointWorkerRequest>) => {
  const token = ++generation
  try {
    if (event.data.type === 'initialize') {
      await initialize(event.data, token)
    } else if (event.data.type === 'reset') {
      prepared = prepareCatalogElements(new Float64Array()); initializing = false
    } else {
      await compute(event.data, token)
    }
  } catch (error) {
    if (token !== generation) return
    initializing = false
    workerScope.postMessage({
      type: 'error', requestId: event.data.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CatalogPointWorkerResponse)
  }
}

export {}
