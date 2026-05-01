import { estimateAphelionDistance, subtractVector3, vector3Magnitude } from './ephemeris'
import type { BodyId, BodyPosition, CelestialBody, Vector2, Vector3 } from '../types'

export function toPlanarPoint(vector: Vector3): Vector2 {
  return { x: vector.x, y: vector.y }
}

export function getRelativePositions(
  bodies: CelestialBody[],
  referenceId: BodyId,
  resolveBodyPosition: (bodyId: BodyId) => Vector3,
): BodyPosition[] {
  const referencePosition = resolveBodyPosition(referenceId)

  return bodies.map((body) => ({
    body,
    position: subtractVector3(resolveBodyPosition(body.id), referencePosition),
  }))
}

export function getSuggestedViewRadius(
  bodyIds: BodyId[],
  referenceId: BodyId,
  bodiesById: Map<BodyId, CelestialBody>,
) {
  const referenceBody = bodiesById.get(referenceId)
  const referenceReach = referenceBody ? estimateAphelionDistance(referenceBody, bodiesById) : 0

  const maxReach = bodyIds.reduce((largest, bodyId) => {
    const body = bodiesById.get(bodyId)
    if (!body) {
      return largest
    }

    return Math.max(largest, estimateAphelionDistance(body, bodiesById) + referenceReach)
  }, 0.02)

  return maxReach * 1.18
}

export function getMaxDistance(bodyPositions: BodyPosition[]) {
  const maxDistance = bodyPositions.reduce((largest, item) => {
    return Math.max(largest, vector3Magnitude(item.position))
  }, 0)

  return maxDistance
}
