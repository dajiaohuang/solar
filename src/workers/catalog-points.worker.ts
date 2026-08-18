/// <reference lib="webworker" />

import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from '../types'
import { propagateCatalogElements } from '../engine/ephemeris/catalogPoints'

const workerScope = self as DedicatedWorkerGlobalScope
function compute(request: CatalogPointWorkerRequest) {
  const { elements, julianDay, requestId } = request
  const positions = propagateCatalogElements(elements, julianDay, (progress) =>
    workerScope.postMessage({ type: 'progress', requestId, progress } satisfies CatalogPointWorkerResponse))
  const response: CatalogPointWorkerResponse = { type: 'result', requestId, progress: 1, positions }
  workerScope.postMessage(response, [positions.buffer])
}

workerScope.onmessage = (event: MessageEvent<CatalogPointWorkerRequest>) => {
  try {
    compute(event.data)
  } catch (error) {
    workerScope.postMessage({
      type: 'error', requestId: event.data.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CatalogPointWorkerResponse)
  }
}

export {}
