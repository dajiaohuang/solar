/// <reference lib="webworker" />

import { createBodyPositionResolver } from '../lib/ephemeris'
import { ensureKernelFiles, kernelsForWindow } from '../engine/ephemeris/kernelStore'
import { getRelativePositions } from '../lib/referenceFrame'
import { createTrajectoryAccumulator } from '../lib/trajectorySamples'
import { SEGMENTED_WEB } from '../lib/webExecution'
import { ensureApproximation } from '../engine/ephemeris/segmentedStore'
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
let activeLoadController: AbortController | null = null

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function compute(request: TrajectoryWorkerRequest) {
  activeRequestId = request.requestId
  const cancelled = () => cancelledRequestId === request.requestId || activeRequestId !== request.requestId
  const reportCancelled = () => workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies TrajectoryWorkerResponse)
  if (!Number.isFinite(request.centerJulianDay) || !Number.isFinite(request.historyDays) || request.historyDays <= 0) throw new Error('Invalid local trajectory window')
  const sampleCount = Math.max(2, request.sampleCount)
  // Reject invalid dimensions without retaining a sample buffer during loading.
  if (!Number.isSafeInteger(sampleCount) || sampleCount > 600 || request.bodies.length > 320) throw new Error('Trajectory detail budget exceeded')
  const loadController = new AbortController()
  activeLoadController = loadController
  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const reference = bodiesById.get(request.referenceId)
  const approximationBodies = reference ? [...request.bodies, reference] : request.bodies
  try {
    if (SEGMENTED_WEB) await ensureApproximation(approximationBodies, request.centerJulianDay, request.centerJulianDay, loadController.signal)
    else await ensureKernelFiles(request.ephemerisFiles ?? [], loadController.signal)
  }
  catch (error) {
    if (loadController.signal.aborted || cancelled()) { reportCancelled(); return }
    throw error
  } finally {
    if (!SEGMENTED_WEB && activeLoadController === loadController) activeLoadController = null
  }
  if (cancelled()) { reportCancelled(); return }
  const accumulator = createTrajectoryAccumulator(request.bodies, sampleCount)
  const kernels = kernelsForWindow(request.centerJulianDay - request.historyDays, request.centerJulianDay, request.ephemerisFiles ?? [])
  let sliceStarted = performance.now()
  for (let index = 0; index < sampleCount; index += 1) {
    if (cancelled()) {
      reportCancelled()
      return
    }
    const progress = index / (sampleCount - 1)
    const julianDay = index === sampleCount-1 ? request.centerJulianDay : request.centerJulianDay - request.historyDays + progress * request.historyDays
    // Load just the sampled epoch and its center dependencies. Long histories
    // never retain decades of coefficients in the worker at once.
    if (SEGMENTED_WEB) {
      try { await ensureApproximation(approximationBodies, julianDay, julianDay, loadController.signal) }
      catch (error) { if (cancelled() || loadController.signal.aborted) { reportCancelled(); return }; throw error }
      if (cancelled()) { reportCancelled(); return }
    }
    const resolve = createBodyPositionResolver(bodiesById, julianDay, kernels)
    const positions = getRelativePositions(request.bodies, request.referenceId, resolve)
    accumulator.append(positions)
    if (index % 12 === 0 || performance.now()-sliceStarted >= 8) {
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        progress: (index+1)/sampleCount,
      } satisfies TrajectoryWorkerResponse)
      await yieldToWorker()
      sliceStarted = performance.now()
    }
  }

  // Process queued cancellation even if the final epoch did not trigger a yield.
  await yieldToWorker()
  if (cancelled()) {
    reportCancelled()
    return
  }
  const packed = accumulator.finish()
  if (activeLoadController === loadController) activeLoadController = null
  const response: TrajectoryWorkerResponse = { type: 'result', requestId: request.requestId, packed }
  workerScope.postMessage(response, [packed.offsets.buffer, packed.coordinates.buffer])
}

workerScope.onmessage = (event: MessageEvent<TrajectoryWorkerRequest | TrajectoryWorkerCancelRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (activeRequestId === request.requestId) {
      cancelledRequestId = request.requestId
      activeLoadController?.abort()
    }
    return
  }
  activeLoadController?.abort()
  void compute(request).catch((error: unknown) => {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies TrajectoryWorkerResponse)
  })
}

export {}
