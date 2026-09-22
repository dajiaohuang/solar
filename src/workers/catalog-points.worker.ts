/// <reference lib="webworker" />

import type { CatalogPointWorkerRequest, CatalogPointWorkerResponse } from './catalog-points.protocol'
import { propagateCatalogElementPositions } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'

const workerScope = self as DedicatedWorkerGlobalScope
let elements: Float64Array<ArrayBufferLike> = new Float64Array()
function compute(request: Extract<CatalogPointWorkerRequest, { type: 'compute' }>) {
  const { julianDay, requestId, mode } = request
  // The scene clock is UTC; MPCORB's unchanged source epochs are TT. Convert
  // once per job, not once per record. Pre-1972 remains exploratory fallback,
  // matching the single-body resolver's explicit historical limitation.
  const epochTt = julianDay >= 2441317.5 ? utcJulianDayToTt(julianDay) : julianDay
  const positions = propagateCatalogElementPositions(elements, epochTt, mode, (progress) =>
    workerScope.postMessage({ type: 'progress', requestId, progress } satisfies CatalogPointWorkerResponse))
  const response: CatalogPointWorkerResponse = { type: 'result', requestId, progress: 1, julianDay, mode, positions }
  workerScope.postMessage(response, [positions.buffer])
}

workerScope.onmessage = (event: MessageEvent<CatalogPointWorkerRequest>) => {
  try {
    if (event.data.type === 'initialize') {
      elements = event.data.elements
      workerScope.postMessage({ type: 'initialized', requestId: event.data.requestId } satisfies CatalogPointWorkerResponse)
    } else if (event.data.type === 'reset') {
      elements = new Float64Array()
    } else {
      compute(event.data)
    }
  } catch (error) {
    workerScope.postMessage({
      type: 'error', requestId: event.data.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CatalogPointWorkerResponse)
  }
}

export {}
