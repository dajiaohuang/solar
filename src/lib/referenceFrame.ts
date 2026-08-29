import { subtractVector3, vector3Magnitude } from './ephemeris'
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
  const referencePath = getReachToAncestors(referenceId, bodiesById)

  const maxReach = bodyIds.reduce((largest, bodyId) => {
    const bodyPath = getReachToAncestors(bodyId, bodiesById)
    if (!bodyPath) return largest

    let relativeReach: number | null = null
    if (referencePath) {
      for (const [ancestorId, bodyReach] of bodyPath.ancestors) {
        const referenceReach = referencePath.ancestors.get(ancestorId)
        if (referenceReach !== undefined) {
          relativeReach = bodyReach + referenceReach
          break
        }
      }
    }

    return Math.max(largest, relativeReach ?? bodyPath.totalReach + (referencePath?.totalReach ?? 0))
  }, 0)

  return (maxReach || 0.02) * 1.18
}

function getLocalOrbitReach(body: CelestialBody) {
  if (!body.orbit) return 0
  const orbit = body.orbit.model === 'planetaryApprox' ? body.orbit.base : body.orbit
  return orbit.semiMajorAxisAU * (1 + orbit.eccentricity)
}

function getParent(body: CelestialBody, bodiesById: Map<BodyId, CelestialBody>) {
  if (body.parentId) return bodiesById.get(body.parentId)
  if (body.id !== 'sun' && body.orbit) return bodiesById.get('sun')
  return undefined
}

function getReachToAncestors(bodyId: BodyId, bodiesById: Map<BodyId, CelestialBody>) {
  let body = bodiesById.get(bodyId)
  if (!body) return null

  const ancestors = new Map<BodyId, number>()
  const visited = new Set<BodyId>()
  let totalReach = 0

  while (body && !visited.has(body.id)) {
    visited.add(body.id)
    ancestors.set(body.id, totalReach)
    const parent = getParent(body, bodiesById)
    if (!parent) {
      totalReach += getLocalOrbitReach(body)
      break
    }
    totalReach += getLocalOrbitReach(body)
    body = parent
  }

  return { ancestors, totalReach }
}

export function getMaxDistance(bodyPositions: BodyPosition[]) {
  const maxDistance = bodyPositions.reduce((largest, item) => {
    return Math.max(largest, vector3Magnitude(item.position))
  }, 0)

  return maxDistance
}
