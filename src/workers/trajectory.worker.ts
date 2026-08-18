/// <reference lib="webworker" />

import { createBodyPositionResolver } from '../lib/ephemeris'
import { getRelativePositions, toPlanarPoint } from '../lib/referenceFrame'
import type {
  BodyId,
  CelestialBody,
  PackedTrajectoryData,
  TrajectoryWorkerCancelRequest,
  TrajectoryWorkerRequest,
  TrajectoryWorkerResponse,
  Vector2,
  Vector3,
} from '../types'

const workerScope = self as DedicatedWorkerGlobalScope
let activeRequestId = 0
let cancelledRequestId = 0

function yieldToWorker() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function packTrajectories(bodyIds: BodyId[], points: Vector2[][], points3D: Vector3[][]): PackedTrajectoryData {
  const totalPoints = points.reduce((sum, bodyPoints) => sum + bodyPoints.length, 0)
  const offsets = new Uint32Array(bodyIds.length + 1)
  const points2D = new Float64Array(totalPoints * 2)
  const packed3D = new Float64Array(totalPoints * 3)
  let cursor = 0
  for (let bodyIndex = 0; bodyIndex < bodyIds.length; bodyIndex += 1) {
    offsets[bodyIndex] = cursor
    for (let pointIndex = 0; pointIndex < points[bodyIndex].length; pointIndex += 1) {
      const point2D = points[bodyIndex][pointIndex]
      const point3D = points3D[bodyIndex][pointIndex]
      points2D[cursor * 2] = point2D.x
      points2D[cursor * 2 + 1] = point2D.y
      packed3D[cursor * 3] = point3D.x
      packed3D[cursor * 3 + 1] = point3D.y
      packed3D[cursor * 3 + 2] = point3D.z
      cursor += 1
    }
  }
  offsets[bodyIds.length] = cursor
  return { bodyIds, offsets, points2D, points3D: packed3D }
}

async function compute(request: TrajectoryWorkerRequest) {
  activeRequestId = request.requestId
  const bodiesById = new Map<BodyId, CelestialBody>(request.resolutionBodies.map((body) => [body.id, body]))
  const points = request.bodies.map(() => [] as Vector2[])
  const points3D = request.bodies.map(() => [] as Vector3[])
  const sampleCount = Math.max(2, request.sampleCount)

  for (let index = 0; index < sampleCount; index += 1) {
    if (cancelledRequestId === request.requestId || activeRequestId !== request.requestId) {
      workerScope.postMessage({ type: 'cancelled', requestId: request.requestId } satisfies TrajectoryWorkerResponse)
      return
    }
    const progress = index / (sampleCount - 1)
    const julianDay = request.centerJulianDay - request.historyDays + progress * request.historyDays
    const resolve = createBodyPositionResolver(bodiesById, julianDay)
    const positions = getRelativePositions(request.bodies, request.referenceId, resolve)
    for (let bodyIndex = 0; bodyIndex < positions.length; bodyIndex += 1) {
      points[bodyIndex].push(toPlanarPoint(positions[bodyIndex].position))
      points3D[bodyIndex].push(positions[bodyIndex].position)
    }
    if (index % 12 === 0) {
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        progress,
      } satisfies TrajectoryWorkerResponse)
      await yieldToWorker()
    }
  }

  const packed = packTrajectories(request.bodies.map((body) => body.id), points, points3D)
  const response: TrajectoryWorkerResponse = { type: 'result', requestId: request.requestId, packed }
  workerScope.postMessage(response, [packed.offsets.buffer, packed.points2D.buffer, packed.points3D.buffer])
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
