/// <reference lib="webworker" />

import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from './catalog-points.protocol'
import { CATALOG_ELEMENT_STRIDE, PREPARED_CATALOG_STRIDE, prepareCatalogElementRange, prepareCatalogElements, propagatePreparedCatalogPositions, type PreparedCatalogElements } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'

const workerScope = self as DedicatedWorkerGlobalScope
let prepared: PreparedCatalogElements = prepareCatalogElements(new Float64Array())
let generation = 0, initializing = false
const CHUNK_ROWS = 20_000
const CHECK_ROWS = 1024
// Scheduling policy only: a single row's solve is not preemptible.
const SLICE_MS = 4
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
  let sliceStarted = performance.now()
  for (let start = 0; start < count; start += CHUNK_ROWS) {
    const chunkEnd = Math.min(count, start + CHUNK_ROWS)
    for (let row = start; row < chunkEnd; row += CHECK_ROWS) {
      const end = Math.min(chunkEnd, row + CHECK_ROWS)
      prepareCatalogElementRange(elements, next, row, end)
      if (end < count && (end === chunkEnd || performance.now()-sliceStarted >= SLICE_MS)) {
        await yieldToMessages()
        if (token !== generation) return
        sliceStarted = performance.now()
      }
    }
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
  let sliceStarted = performance.now()
  for (let start = 0; start < source.count; start += CHUNK_ROWS) {
    const chunkEnd = Math.min(source.count, start + CHUNK_ROWS)
    for (let row = start; row < chunkEnd; row += CHECK_ROWS) {
      const end = Math.min(chunkEnd, row + CHECK_ROWS)
      propagatePreparedCatalogPositions(source, epochTt, mode, positions, row, end)
      if (end < source.count && (end === chunkEnd || performance.now()-sliceStarted >= SLICE_MS)) {
        // Preserve progress-message cadence; extra cancellation checkpoints
        // must not create a new stream of main-thread UI updates.
        if (end === chunkEnd) workerScope.postMessage({ type: 'progress', requestId, progress: end / source.count } satisfies CatalogPointWorkerResponse)
        await yieldToMessages()
        if (token !== generation) return
        sliceStarted = performance.now()
      }
    }
  }
  const response: CatalogPointWorkerResponse = { type: 'result', requestId, progress: 1, julianDay, mode, positions }
  workerScope.postMessage(response, [positions.buffer])
}

let pending: { request: Exclude<CatalogPointWorkerRequest, { type: 'reset' }>; token: number } | null = null
let running = false

async function drain() {
  if (running) return
  running = true
  try {
    while (pending) {
      const { request, token } = pending
      pending = null
      try {
        if (request.type === 'initialize') await initialize(request, token)
        else await compute(request, token)
      } catch (error) {
        if (token !== generation) continue
        initializing = false
        workerScope.postMessage({
          type: 'error', requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error),
        } satisfies CatalogPointWorkerResponse)
      }
    }
  } finally { running = false }
}

workerScope.onmessage = (event: MessageEvent<CatalogPointWorkerRequest>) => {
  const token = ++generation
  if (event.data.type === 'reset') {
    pending = null
    prepared = prepareCatalogElements(new Float64Array()); initializing = false
    return
  }
  // Invalidate the active job immediately, but wait for its next checkpoint
  // and function exit before allocating another prepared/output buffer.
  // Repeated replacements retain only the latest delivered input request.
  pending = { request: event.data, token }
  void drain()
}

export {}
