import { createBodyPositionResolver, subtractVector3, vector3Magnitude } from '../../lib/ephemeris'
import type { SpacecraftDef } from '../../data/spacecraft'
import type { BodyId, CelestialBody, RenderedBodyPosition, TrajectorySample, Vector3 } from '../../types'

function interpolate(points: SpacecraftDef['trajectoryPoints'], julianDay: number): Vector3 {
  if (julianDay <= points[0].jd) return points[0]
  if (julianDay >= points[points.length - 1].jd) return points[points.length - 1]
  const upperIndex = points.findIndex((point) => point.jd >= julianDay)
  const lower = points[upperIndex - 1]
  const upper = points[upperIndex]
  const fraction = (julianDay - lower.jd) / (upper.jd - lower.jd)
  return {
    x: lower.x + (upper.x - lower.x) * fraction,
    y: lower.y + (upper.y - lower.y) * fraction,
    z: lower.z + (upper.z - lower.z) * fraction,
  }
}

export function buildSpacecraftFrame(
  spacecraft: SpacecraftDef[],
  referenceId: BodyId,
  bodiesById: Map<BodyId, CelestialBody>,
  julianDay: number,
) {
  const resolver = createBodyPositionResolver(bodiesById, julianDay)
  const reference = resolver(referenceId)
  const currentPositions: RenderedBodyPosition[] = spacecraft.filter((body) => julianDay >= body.trajectoryPoints[0].jd).map((body) => {
    const relative = subtractVector3(interpolate(body.trajectoryPoints, julianDay), reference)
    return {
      body,
      planarPosition: { x: relative.x, y: relative.y },
      position3D: relative,
      distance: vector3Magnitude(relative),
    }
  })
  const trajectories: TrajectorySample[] = spacecraft.map((body) => ({
    body,
    points: body.trajectoryPoints.map((point) => {
      const relative = subtractVector3(point, createBodyPositionResolver(bodiesById, point.jd)(referenceId))
      return { x: relative.x, y: relative.y }
    }),
    points3D: body.trajectoryPoints.map((point) =>
      subtractVector3(point, createBodyPositionResolver(bodiesById, point.jd)(referenceId))),
  }))
  return { currentPositions, trajectories }
}
