import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from '../workers/catalog-points.protocol'

type Send = (request: CatalogPointWorkerRequest, transfer?: Transferable[]) => void

export type CatalogPointResult = {
  requestId: number
  julianDay: number
  positions: Float32Array
  positions3D: Float32Array
}

/** Keeps one element set in the worker and coalesces clock updates while busy. */
export function createCatalogPointWorkerScheduler(
  send: Send,
  callbacks: {
    onProgress: (progress: number) => void
    onResult: (result: CatalogPointResult) => void
    onError: (message: string) => void
  },
) {
  let nextRequestId = 0
  let elementRequestId: number | null = null
  let activeComputeId: number | null = null
  let generation = 0
  let activeComputeGeneration: number | null = null
  let initialized = false
  let queuedJulianDay: number | null = null

  const safeSend = (request: CatalogPointWorkerRequest, transfer?: Transferable[]) => {
    try {
      send(request, transfer)
      return true
    } catch (error) {
      activeComputeId = null
      activeComputeGeneration = null
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
    safeSend({ type: 'compute', requestId, julianDay })
  }

  return {
    setElements(elements: Float64Array) {
      generation += 1
      initialized = false
      activeComputeId = null
      activeComputeGeneration = null
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
      activeComputeId = null
      activeComputeGeneration = null
      if (response.type === 'error') {
        queuedJulianDay = null
        callbacks.onError(response.error ?? 'Catalog point propagation failed')
        return
      }
      callbacks.onResult({
          requestId: response.requestId,
          julianDay: response.julianDay,
          positions: response.positions,
          positions3D: response.positions3D,
        })
      flush()
    },
    reset(sendReset = true) {
      if (sendReset) safeSend({ type: 'reset', requestId: ++nextRequestId })
      generation += 1
      elementRequestId = null
      activeComputeId = null
      activeComputeGeneration = null
      initialized = false
      queuedJulianDay = null
    },
  }
}
