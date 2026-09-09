import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from '../workers/catalog-points.protocol'
import { CATALOG_ELEMENT_STRIDE, type CatalogPointMode } from '../engine/ephemeris/catalogPoints'

type Send = (request: CatalogPointWorkerRequest, transfer?: Transferable[]) => void

export type CatalogPointResult = {
  requestId: number
  julianDay: number
  positions: Float32Array
  mode: CatalogPointMode
}

/** Keeps one element set in the worker and coalesces clock updates while busy. */
export function createCatalogPointWorkerScheduler(
  send: Send,
  callbacks: {
    onProgress: (progress: number) => void
    onResult: (result: CatalogPointResult) => void
    onError: (message: string) => void
  },
  mode: CatalogPointMode,
) {
  let nextRequestId = 0
  let elementRequestId: number | null = null
  let activeComputeId: number | null = null
  let generation = 0
  let activeComputeGeneration: number | null = null
  let activeComputeEpoch: number | null = null
  let elementCount = 0
  let initialized = false
  let queuedJulianDay: number | null = null

  const safeSend = (request: CatalogPointWorkerRequest, transfer?: Transferable[]) => {
    try {
      send(request, transfer)
      return true
    } catch (error) {
      activeComputeId = null
      activeComputeGeneration = null
      activeComputeEpoch = null
      initialized = false
      queuedJulianDay = null
      callbacks.onError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const flush = () => {
    if (!initialized || activeComputeId !== null || queuedJulianDay === null) return
    const julianDay = queuedJulianDay
    queuedJulianDay = null
    const requestId = ++nextRequestId
    activeComputeId = requestId
    activeComputeGeneration = generation
    activeComputeEpoch = julianDay
    safeSend({ type: 'compute', requestId, julianDay, mode })
  }

  return {
    setElements(elements: Float64Array) {
      elementCount = elements.length / CATALOG_ELEMENT_STRIDE
      generation += 1
      initialized = false
      activeComputeId = null
      activeComputeGeneration = null
      activeComputeEpoch = null
      elementRequestId = ++nextRequestId
      safeSend({ type: 'initialize', requestId: elementRequestId, elements }, [elements.buffer])
    },
    requestJulianDay(julianDay: number) {
      queuedJulianDay = julianDay
      flush()
    },
    handle(response: CatalogPointWorkerResponse) {
      if (response.type === 'initialized') {
        if (response.requestId !== elementRequestId) return
        initialized = true
        flush()
        return
      }
      if (response.type === 'error' && response.requestId === elementRequestId) {
        initialized = false
        elementRequestId = null
        queuedJulianDay = null
        callbacks.onError(response.error ?? 'Catalog point worker initialization failed')
        return
      }
      if (response.requestId !== activeComputeId || activeComputeGeneration !== generation) return
      if (response.type === 'progress') {
        callbacks.onProgress(response.progress ?? 0)
        return
      }
      const expectedEpoch = activeComputeEpoch
      activeComputeId = null
      activeComputeGeneration = null
      activeComputeEpoch = null
      if (response.type === 'error') {
        queuedJulianDay = null
        callbacks.onError(response.error ?? 'Catalog point propagation failed')
        return
      }
      if (response.mode !== mode || response.julianDay !== expectedEpoch ||
          response.positions.length !== elementCount * (mode === '2d' ? 2 : 3)) {
        queuedJulianDay = null
        callbacks.onError('Catalog point result does not match the requested mode, epoch or record count')
        return
      }
      callbacks.onResult({
          requestId: response.requestId,
          julianDay: response.julianDay,
          positions: response.positions,
          mode: response.mode,
        })
      flush()
    },
    reset(sendReset = true) {
      if (sendReset) safeSend({ type: 'reset', requestId: ++nextRequestId })
      generation += 1
      elementRequestId = null
      activeComputeId = null
      activeComputeGeneration = null
      activeComputeEpoch = null
      initialized = false
      queuedJulianDay = null
    },
  }
}
