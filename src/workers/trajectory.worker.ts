/// <reference lib="webworker" />

import { buildTrajectoryFrame } from '../lib/trajectory'
import type { BodyId, CelestialBody, TrajectoryWorkerRequest, TrajectoryWorkerResponse } from '../types'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<TrajectoryWorkerRequest>) => {
  const request = event.data

  if (request.type !== 'compute') {
    return
  }

  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const frame = buildTrajectoryFrame({
    bodies: request.bodies,
    bodiesById,
    referenceId: request.referenceId,
    centerJulianDay: request.centerJulianDay,
    historyDays: request.historyDays,
    sampleCount: request.sampleCount,
  })

  const response: TrajectoryWorkerResponse = {
    type: 'result',
    requestId: request.requestId,
    frame,
  }

  workerScope.postMessage(response)
}

export {}
