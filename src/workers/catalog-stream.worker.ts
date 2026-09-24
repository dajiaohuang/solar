/// <reference lib="webworker" />
import { requireCatalogAccess } from '../lib/productAccess'
import { planCatalogStream, streamCatalogPoints, createCatalogStreamSourceCache, clearCatalogStreamSourceCache, type CatalogStreamSourceCache } from '../lib/catalogStreaming'
import { createCatalogTransferWindow } from '../lib/catalogTransferWindow'
import { selectCatalogSpatialPoints } from '../lib/catalogSpatialSelection'
import { createCatalogEpochStore } from '../lib/catalogEpochStore'
import { createCatalogSpatialIndex } from '../lib/catalogSpatialIndex'
import { prepareCatalogAppendBatch } from '../lib/catalogAppendBatch'
import { createCatalogSourceAppendLookup } from '../lib/catalogSourceAppendLookup'
import { CATALOG_APPEND_TIMEOUT_MS } from '../lib/catalogAppendLimits'
import { hasOnlyFiniteValues } from '../lib/finiteFloatArray'
import type { CatalogStreamRequest, CatalogStreamResponse } from './catalog-stream.protocol'

const scope = self as DedicatedWorkerGlobalScope
let controller: AbortController | null = null
let transfers: ReturnType<typeof createCatalogTransferWindow> | null = null
const transferredPositions = new Map<number, number>()
let recycledPositions: Float64Array | null = null
let spatialPositions = new Float32Array(), availablePoints = 0
let dimensions = 2
let spatialIndex: ReturnType<typeof createCatalogSpatialIndex> | undefined
let epochs: ReturnType<typeof createCatalogEpochStore> | null = null
let pendingEpoch: Extract<CatalogStreamRequest, { type: 'epoch' }> | null = null
let epochGeneration = 0, computingEpoch = false, spatialCoherent = true
let epochUpload: { requestId: number; startRow: number; elements: number; resolve: (buffer: Float64Array) => void; reject: (error: unknown) => void } | null = null
let epochReuse: { requestId: number; startRow: number; count: number; resolve: () => void; reject: (error: unknown) => void } | null = null
let pendingView: Extract<CatalogStreamRequest, { type: 'view' }> | null = null
let selecting = false, viewGeneration = 0
let terminalFailure = false
let appendState: { start: Extract<CatalogStreamRequest, { type: 'start' }>; lookup: ReturnType<typeof createCatalogSourceAppendLookup>;
  contentSha256: string; indexSha256: string; remaining: number; sourceCache: CatalogStreamSourceCache } | null = null
let appending = false, appendGeneration = 0, completedJulianDay = NaN
let appendUpload: { requestId: number; startRow: number; count: number; resolve: () => void; reject: (error: unknown) => void } | null = null
// Scientific positions remain Float64. Reject overflow in the separate visual
// copy before making those rows available to the spatial index or consumer.
const installSpatialPositions = (positions: Float64Array, startRow: number) => {
  const offset = startRow*dimensions
  if (!Number.isSafeInteger(startRow) || startRow < 0 || positions.length % dimensions !== 0 ||
      offset+positions.length > spatialPositions.length) throw new Error('Catalog spatial upload exceeds its admitted layout')
  spatialPositions.set(positions,offset)
  if (!hasOnlyFiniteValues(spatialPositions.subarray(offset,offset+positions.length))) {
    throw new Error('Catalog coordinates exceed spatial coordinate representation')
  }
  spatialIndex?.invalidate(startRow,positions.length/dimensions)
}
const discardFailedSnapshot = () => {
  terminalFailure = true
  recycledPositions = null; transferredPositions.clear()
  epochs = null; pendingEpoch = null
  if (appendState) clearCatalogStreamSourceCache(appendState.sourceCache)
  appendState = null
  spatialPositions = new Float32Array(); spatialIndex = undefined; availablePoints = 0
  spatialCoherent = false; viewGeneration++; pendingView = null
}
const channel = new MessageChannel(), continuations: (() => void)[] = []
channel.port1.onmessage = () => continuations.shift()?.()
const yieldToMessages = () => new Promise<void>(resolve => { continuations.push(resolve); channel.port2.postMessage(null) })
const CATALOG_STREAM_COOPERATIVE_SLICE_MS = 4
let lastCatalogStreamYieldAt = -Infinity
const yieldCatalogStreamMessages = () => {
  if (performance.now() - lastCatalogStreamYieldAt < CATALOG_STREAM_COOPERATIVE_SLICE_MS) return Promise.resolve()
  return yieldToMessages().then(() => { lastCatalogStreamYieldAt = performance.now() })
}

const failRequestChannel = () => {
  const requestId = epochGeneration, temporal = computingEpoch || pendingEpoch !== null
  controller?.abort(); discardFailedSnapshot()
  scope.postMessage((temporal
    ? { type: 'epoch-error', requestId, error: 'Catalog epoch request could not be decoded' }
    : { type: 'error', error: 'Catalog stream request could not be decoded' }) satisfies CatalogStreamResponse)
}
scope.onmessageerror = failRequestChannel

async function selectViews() {
  if (selecting) return
  selecting = true
  try {
    while (pendingView) {
      const request = pendingView, generation = viewGeneration
      pendingView = null
      try {
        if (!spatialCoherent) throw new Error('Spatial view requires a completed catalog epoch')
        if (request.count > availablePoints) throw new Error('Spatial view exceeds computed source rows')
        if (Boolean(request.view.rotation) !== (dimensions === 3)) throw new Error('Spatial view dimension does not match its source snapshot')
        const selectionStarted = performance.now()
        const result = await selectCatalogSpatialPoints(spatialPositions, request.count, request.view, () => generation !== viewGeneration, yieldToMessages, spatialIndex)
        const selectionMs = performance.now() - selectionStarted
        if (result && generation === viewGeneration) scope.postMessage({ type: 'selection', requestId: request.requestId, count: request.count, indices: result.indices, visible: result.visible,
          edgeCandidates: result.edgeCandidates, selectionMs, testedRows: result.testedRows, skippedRows: result.skippedRows } satisfies CatalogStreamResponse, [result.indices.buffer])
      } catch (error) {
        if (generation === viewGeneration) scope.postMessage({ type: 'selection-error', requestId: request.requestId, count: request.count,
          error: error instanceof Error ? error.message : String(error) } satisfies CatalogStreamResponse)
      }
    }
  } finally { selecting = false }
}

async function computeEpochs() {
  if (computingEpoch) return
  computingEpoch = true
  try {
    while (pendingEpoch && epochs?.ready && controller && !controller.signal.aborted) {
      const request = pendingEpoch, store = epochs, signal = controller.signal
      pendingEpoch = null
      spatialCoherent = false; viewGeneration++; pendingView = null
      try {
        scope.postMessage({ type: 'epoch-start', requestId: request.requestId, julianDay: request.julianDay, count: store.count } satisfies CatalogStreamResponse)
        const result = await store.computeEpoch({ julianDay: request.julianDay, signal, tileRows: 16384, superseded: () => epochGeneration !== request.requestId,
          maximumDriftAU: request.maximumDriftAU,
          yieldControl: yieldToMessages,
          // Zero drift still admits blocks computed at exactly this epoch.
          // Keep their ownership/receipt handshake when tightening the budget.
          onReuse: block => new Promise<void>((resolve, reject) => {
            let settled = false
            const deadline = performance.now() + 30_000
            const clean = () => {
              if (settled) return false
              settled = true
              clearTimeout(timer); signal.removeEventListener('abort', abort); epochReuse = null
              return true
            }
            const fail = (error: unknown) => { if (clean()) reject(error) }
            const timeout = () => fail(new Error('Catalog reused-block ACK exceeded 30 seconds'))
            const finish = () => {
              if (performance.now() >= deadline) { timeout(); return }
              if (clean()) resolve()
            }
            const abort = () => fail(signal.reason ?? new DOMException('Catalog epoch cancelled', 'AbortError'))
            const timer = setTimeout(timeout, 30_000)
            epochReuse = { requestId: request.requestId, startRow: block.startRow, count: block.count, resolve: finish, reject: fail }
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) { abort(); return }
            try { scope.postMessage({ type: 'epoch-reuse', requestId: request.requestId, ...block } satisfies CatalogStreamResponse) }
            catch (error) { fail(error) }
          }),
          onTile: tile => new Promise<Float64Array>((resolve, reject) => {
            let settled = false
            const deadline = performance.now() + 30_000
            const clean = () => {
              if (settled) return false
              settled = true
              clearTimeout(timer); signal.removeEventListener('abort', abort); epochUpload = null
              return true
            }
            const fail = (error: unknown) => { if (clean()) reject(error) }
            const timeout = () => fail(new Error('Catalog epoch upload ACK exceeded 30 seconds'))
            const finish = (positions: Float64Array) => {
              if (performance.now() >= deadline) { timeout(); return }
              if (clean()) resolve(positions)
            }
            const abort = () => fail(signal.reason ?? new DOMException('Catalog epoch cancelled', 'AbortError'))
            const timer = setTimeout(timeout, 30_000)
            epochUpload = { requestId: request.requestId, startRow: tile.startRow, elements: tile.positions.length, resolve: finish, reject: fail }
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) { abort(); return }
            try {
              installSpatialPositions(tile.positions,tile.startRow)
              scope.postMessage({ type: 'epoch-tile', requestId: request.requestId, ...tile } satisfies CatalogStreamResponse, [tile.positions.buffer])
            } catch (error) { fail(error) }
          }),
        })
        if (result && request.requestId === epochGeneration) {
          completedJulianDay = result.julianDay
          scope.postMessage({ type: 'epoch-done', requestId: request.requestId, ...result } satisfies CatalogStreamResponse, [result.blockEpochs.buffer])
          spatialCoherent = true
        }
      } catch (error) {
        if (!signal.aborted && request.requestId === epochGeneration) {
          discardFailedSnapshot()
          scope.postMessage({ type: 'epoch-error', requestId: request.requestId,
            error: error instanceof Error ? error.message : String(error) } satisfies CatalogStreamResponse)
        }
      }
    }
  } finally { computingEpoch = false }
}

async function appendSources(request: Extract<CatalogStreamRequest, { type: 'append' }>) {
  const state = appendState, store = epochs, signal = controller?.signal
  if (!state || !store?.ready || !signal || signal.aborted || appending || computingEpoch || pendingEpoch || !spatialCoherent ||
      !Number.isSafeInteger(request.requestId) || request.requestId <= appendGeneration || request.startRow !== availablePoints ||
      request.julianDay !== completedJulianDay || state.remaining < 1 || !Array.isArray(request.locators) ||
      !request.locators.length || request.locators.length > 256) {
    scope.postMessage({ type: 'append-error', requestId: request.requestId, error: 'Catalog append source, epoch or capacity is unavailable' } satisfies CatalogStreamResponse)
    return
  }
  appendGeneration = request.requestId; appending = true
  viewGeneration++; pendingView = null; spatialCoherent = false
  const activeController = controller!
  const deadline = performance.now()+CATALOG_APPEND_TIMEOUT_MS
  const timeoutError = () => new Error('Catalog append exceeded its 300-second resource limit')
  const timeout = setTimeout(() => activeController.abort(timeoutError()),CATALOG_APPEND_TIMEOUT_MS)
  const checkDeadline = () => {
    if (performance.now() >= deadline && !signal.aborted) activeController.abort(timeoutError())
    signal.throwIfAborted()
  }
  let reservation: ReturnType<typeof state.lookup.prepareAppend> | undefined
  try {
    checkDeadline()
    requireCatalogAccess('scan')
    if (request.locators.some(locator => state.lookup.row(locator) !== undefined)) throw new Error('Catalog append includes an already uploaded body')
    const batch = await prepareCatalogAppendBatch({ ...state.start, mode: state.start.mode ?? '2d',
      julianDay: request.julianDay, maximumRows: state.remaining, locators: request.locators,
      contentSha256: state.contentSha256, indexSha256: state.indexSha256, signal, yieldControl: yieldToMessages, sourceCache: state.sourceCache })
    checkDeadline()
    const count = batch.prepared.count
    if (count) {
      reservation = state.lookup.prepareAppend(batch.result.sourceSelection!,request.startRow)
      if (reservation.count !== count) throw new Error('Catalog append source mask differs from prepared rows')
      // Tail storage is not visible to selection until ACK. Preserve original
      // Float64 positions for transport; Float32 is exclusively the culling copy.
      installSpatialPositions(batch.positions,request.startRow)
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now()+30_000
        let settled = false
        const clean = () => {
          if (settled) return false
          settled = true; clearTimeout(timer); signal.removeEventListener('abort',abort); appendUpload = null
          return true
        }
        const fail = (error: unknown) => { if (clean()) reject(error) }
        const abort = () => fail(signal.reason ?? new DOMException('Catalog append cancelled','AbortError'))
        const timer = setTimeout(() => fail(new Error('Catalog append upload ACK exceeded 30 seconds')),30_000)
        appendUpload = { requestId: request.requestId, startRow: request.startRow, count,
          resolve: () => {
            try { checkDeadline() } catch (error) { fail(error); return }
            if (performance.now() >= deadline) { fail(new Error('Catalog append upload ACK exceeded 30 seconds')); return }
            if (clean()) resolve()
          }, reject: fail }
        signal.addEventListener('abort',abort,{once:true})
        if (signal.aborted) { abort(); return }
        try { scope.postMessage({ type: 'append-tile', requestId: request.requestId, startRow: request.startRow,
          count, julianDay: request.julianDay, positions: batch.positions, appearance: batch.appearance,
          result: batch.result } satisfies CatalogStreamResponse,[batch.positions.buffer,batch.appearance.buffer]) }
        catch (error) { fail(error) }
      })
      checkDeadline()
      store.appendUploaded(batch.prepared,request.startRow,batch.result.maximumSpeedAUPerTtDay ?? null,request.julianDay)
      checkDeadline()
      reservation.commit(request.startRow,count)
      availablePoints += count; state.remaining -= count
    }
    checkDeadline()
    spatialCoherent = true
    scope.postMessage({ type: 'append-done', requestId: request.requestId, startRow: request.startRow,
      addedRows: count, count: availablePoints, julianDay: request.julianDay, result: batch.result } satisfies CatalogStreamResponse)
  } catch (error) {
    reservation?.cancel()
    // A tile may already have reached GPU storage. Fail the snapshot as a unit;
    // never claim rollback or keep a main/worker layout with different row counts.
    controller?.abort(); discardFailedSnapshot()
    scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) } satisfies CatalogStreamResponse)
  } finally { clearTimeout(timeout); appending = false }
}

scope.onmessage = (event: MessageEvent<CatalogStreamRequest>) => {
  if (terminalFailure) return
  const request = event.data
  if (!request || typeof request !== 'object' || ![
    'start', 'ack', 'cancel', 'view-cancel', 'view', 'epoch', 'epoch-ack', 'epoch-reuse-ack', 'append', 'append-ack',
  ].includes(request.type)) { failRequestChannel(); return }
  if (request.type === 'append') { void appendSources(request); return }
  if (request.type === 'append-ack') {
    const upload = appendUpload
    if (!upload || request.requestId !== upload.requestId) return
    if (request.startRow !== upload.startRow || request.count !== upload.count) upload.reject(new Error('Catalog append ACK layout mismatch'))
    else upload.resolve()
    return
  }
  if (request.type === 'epoch-reuse-ack') {
    const reuse = epochReuse
    if (!reuse || reuse.requestId !== request.requestId || reuse.startRow !== request.startRow) return
    if (reuse.count !== request.count) reuse.reject(new Error('Invalid catalog reused-block ACK count'))
    else reuse.resolve()
    return
  }
  if (request.type === 'epoch-ack') {
    const upload = epochUpload
    if (!upload || upload.requestId !== request.requestId || upload.startRow !== request.startRow) return
    if (!(request.positions instanceof Float64Array) || request.positions.length !== upload.elements || request.positions.byteOffset !== 0 ||
        !(request.positions.buffer instanceof ArrayBuffer) || request.positions.buffer.byteLength !== upload.elements*8) upload.reject(new Error('Invalid returned catalog epoch buffer'))
    else upload.resolve(request.positions)
    return
  }
  if (request.type === 'epoch') {
    if (appending || !epochs?.ready || controller?.signal.aborted || !Number.isSafeInteger(request.requestId) || request.requestId <= epochGeneration ||
        !Number.isFinite(request.julianDay) || request.julianDay < 2441317.5 ||
        request.maximumDriftAU !== undefined && (!Number.isFinite(request.maximumDriftAU) || request.maximumDriftAU < 0 || request.maximumDriftAU > 1)) {
      scope.postMessage({ type: 'epoch-error', requestId: request.requestId, error: 'Invalid epoch request or retained source not ready' } satisfies CatalogStreamResponse)
      return
    }
    epochGeneration = request.requestId; pendingEpoch = request
    viewGeneration++; pendingView = null; spatialCoherent = false
    void computeEpochs(); return
  }
  if (request.type === 'view-cancel') { viewGeneration++; pendingView = null; return }
  if (request.type === 'view') { viewGeneration++; pendingView = request; void selectViews(); return }
  if (request.type === 'cancel') { controller?.abort(); if (appendState) clearCatalogStreamSourceCache(appendState.sourceCache); appendState = null; recycledPositions = null; transferredPositions.clear(); epochs = null; pendingEpoch = null; viewGeneration++; pendingView = null; return }
  if (request.type === 'ack') {
    const elements = transferredPositions.get(request.tileId)
    if (elements === undefined || controller?.signal.aborted) return
    if (request.positions !== undefined) {
      const positions = request.positions
      if (!(positions instanceof Float64Array) || positions.length !== elements || positions.byteOffset !== 0 ||
          !(positions.buffer instanceof ArrayBuffer) || positions.buffer.byteLength !== elements*8) {
        controller?.abort(); discardFailedSnapshot()
        scope.postMessage({ type: 'error', error: 'Invalid returned catalog source buffer' } satisfies CatalogStreamResponse)
        return
      }
      // One slot only. Partial final shards never leave a growing size-keyed
      // pool behind; the next compute either consumes this buffer or drops it.
      recycledPositions = positions
    }
    transferredPositions.delete(request.tileId)
    transfers?.acknowledge(request.tileId)
    return
  }
  if (controller) return // One immutable request owns each worker.
  controller = new AbortController()
  const active = controller
  const window = createCatalogTransferWindow(active.signal)
  transfers = window
  const capturePerformance = request.capturePerformanceReceipt === true
  const workerStartedAt = performance.now()
  let workerSetupMs = 0, visualCoordinateInstallationMs = 0, transferWindowDrainMs = 0
  void (async () => {
    try {
      requireCatalogAccess('scan')
      const mode = request.mode ?? '2d'
      dimensions = mode === '3d' ? 3 : 2
      const plan = planCatalogStream(request.manifest, request.requestedRows, request.budgetBytes, mode, request.retainEpochs, request.appendRows)
      if (!plan.capacity) throw new Error('Catalog index, metadata and pipeline reserves exceed the available streaming budget')
      spatialPositions = new Float32Array(plan.capacity * dimensions)
      spatialIndex = createCatalogSpatialIndex(spatialPositions, mode === '3d' ? 3 : 2)
      epochs = request.retainEpochs ? createCatalogEpochStore(plan.capacity, mode, plan.maximumEpochBlocks) : null
      const sourceCache = plan.appendCapacity ? createCatalogStreamSourceCache(request.manifest.totalCount*24,request.manifest.chunkSize*64) : undefined
      if (capturePerformance) workerSetupMs = performance.now() - workerStartedAt
      lastCatalogStreamYieldAt = -Infinity
      const result = await streamCatalogPoints({
        ...request, capturePerformanceReceipt: capturePerformance, signal: active.signal, yieldControl: yieldCatalogStreamMessages, sourceCache,
        acquirePositions: elements => {
          const returned = recycledPositions
          recycledPositions = null
          return returned?.length === elements ? returned : new Float64Array(elements)
        },
        onPrepared: epochs ? (prepared, startRow, speed) => epochs!.append(prepared, startRow, speed) : undefined,
        onTile: tile => {
          // This Float32 copy is exclusively for visual culling. Scientific
          // propagation and the transferred source snapshot remain Float64.
          const installStarted = capturePerformance ? performance.now() : 0
          installSpatialPositions(tile.positions,tile.drawnRows-tile.positions.length/dimensions)
          if (capturePerformance) visualCoordinateInstallationMs += performance.now() - installStarted
          availablePoints = tile.drawnRows
          return window.publish(tileId => {
            transferredPositions.set(tileId, tile.positions.length)
            // Clone the mask: the producer retains it for final selection
            // evidence, so transferring its buffer would detach that record.
            scope.postMessage({ type: 'tile', tileId, ...tile } satisfies CatalogStreamResponse, [tile.positions.buffer, tile.appearance.buffer])
          })
        },
      })
      const drainStarted = capturePerformance ? performance.now() : 0
      await window.drain()
      if (capturePerformance) transferWindowDrainMs = performance.now() - drainStarted
      active.signal.throwIfAborted()
      epochs?.seal(result.drawnRows, request.julianDay)
      completedJulianDay = request.julianDay
      if (plan.appendCapacity && result.sourceSelection && sourceCache) {
        appendState = { start: structuredClone(request), lookup: createCatalogSourceAppendLookup(result.sourceSelection,plan.capacity),
          contentSha256: result.sourceSelection.contentSha256, indexSha256: result.sourceSelection.indexSha256, remaining: plan.appendCapacity, sourceCache }
      }
      if (capturePerformance && result.performanceMs) {
        result.performanceMs.workerSetupMs = workerSetupMs
        result.performanceMs.visualCoordinateInstallationMs = visualCoordinateInstallationMs
        result.performanceMs.transferWindowDrainMs = transferWindowDrainMs
        result.performanceMs.workerTotalMs = performance.now() - workerStartedAt
      }
      scope.postMessage({ type: 'done', retainedEpochs: epochs !== null, ...result } satisfies CatalogStreamResponse)
    } catch (error) {
      epochs = null
      if (!active.signal.aborted) discardFailedSnapshot()
      scope.postMessage(active.signal.aborted ? { type: 'cancelled' } : {
        type: 'error', error: error instanceof Error ? error.message : String(error),
      } satisfies CatalogStreamResponse)
    } finally { window.dispose(); transfers = null; transferredPositions.clear(); recycledPositions = null }
  })()
}

export {}
