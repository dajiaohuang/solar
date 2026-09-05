/// <reference lib="webworker" />

import { createBodyPositionResolver } from '../lib/ephemeris'
import { ensureKernelFiles, kernelsForWindow } from '../engine/ephemeris/kernelStore'
import { getRelativePositions } from '../lib/referenceFrame'
import { createTrajectoryAccumulator } from '../lib/trajectorySamples'
import type {
  BodyId,
  CelestialBody,
  TrajectoryWorkerCancelRequest,
  TrajectoryWorkerRequest,
  TrajectoryWorkerResponse,
} from '../types'

const workerScope = self as DedicatedWorkerGlobalScope
let activeRequestId = 0
let cancelledRequestId = 0

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function compute(request: TrajectoryWorkerRequest) {
  activeRequestId = request.requestId
  await ensureKernelFiles(request.ephemerisFiles ?? [])
  const kernels = kernelsForWindow(request.centerJulianDay - request.historyDays, request.centerJulianDay, request.ephemerisFiles ?? [])
  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const sampleCount = Math.max(2, request.sampleCount)
  const accumulator = createTrajectoryAccumulator(request.bodies, sampleCount)

  for (let index = 0; index < sampleCount; index += 1) {
    if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
      workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies TrajectoryWorkerResponse)
      return
    }
    const progress = index / (sampleCount - 1)
    const julianDay = request.centerJulianDay - request.historyDays + progress * request.historyDays
    const resolve = createBodyPositionResolver(bodiesById, julianDay, kernels)
    const positions = getRelativePositions(request.bodies, request.referenceId, resolve)
    accumulator.append(positions)
    if (index % 12 === 0) {
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        progress,
      } satisfies TrajectoryWorkerResponse)
      await yieldToWorker()
    }
  }

  // The final progress yield can deliver cancellation or a newer request.
  if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
    workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies TrajectoryWorkerResponse)
    return
  }
  const packed = accumulator.finish()
  const response: TrajectoryWorkerResponse = { type: 'result', requestId: request.requestId, packed }
  workerScope.postMessage(response, [packed.offsets.buffer, packed.coordinates.buffer])
}

workerScope.onmessage = (event: MessageEvent<TrajectoryWorkerRequest | TrajectoryWorkerCancelRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelledRequestId = request.requestId
    return
  }
  void compute(request).catch((error: unknown) => {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies TrajectoryWorkerResponse)
  })
}

export {}
