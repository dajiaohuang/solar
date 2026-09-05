import { bodyPositionOrNull, createBodyPositionResolver, subtractVector3 } from '../../lib/ephemeris'
import { EMPTY_CURRENT_POSITIONS, packedCurrentPositions } from '../../lib/currentPositions'
import { kernelsForWindow } from './kernelStore'
import type { SpacecraftDef } from '../../data/spacecraft'
import type { BodyId, CelestialBody, TrajectorySample, Vector3 } from '../../types'

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
  const reference = bodyPositionOrNull(resolver, referenceId)
  if (!reference) return { currentPositions: EMPTY_CURRENT_POSITIONS, trajectories: [], trajectoryUnavailableBodyIds: spacecraft.map((body) => body.id) }
  const visible = spacecraft.filter((body) => julianDay >= body.trajectoryPoints[0].jd)
  const coordinates = new Float64Array(visible.length * 3)
  for (let index = 0; index < visible.length; index++) {
    const body = visible[index]
    const relative = subtractVector3(interpolate(body.trajectoryPoints, julianDay), reference)
    coordinates[index * 3] = relative.x; coordinates[index * 3 + 1] = relative.y; coordinates[index * 3 + 2] = relative.z
  }
  const currentPositions = packedCurrentPositions(visible, coordinates)
  const trajectoryUnavailableBodyIds: BodyId[] = []
  const trajectories: TrajectorySample[] = spacecraft.flatMap((body) => {
    const historicalKernels = body.trajectoryPoints.length
      ? kernelsForWindow(body.trajectoryPoints[0].jd, body.trajectoryPoints[body.trajectoryPoints.length - 1].jd)
      : []
    const points3D = body.trajectoryPoints.map((point) => {
      const historicalReference = bodyPositionOrNull(createBodyPositionResolver(bodiesById, point.jd, historicalKernels), referenceId)
      return historicalReference ? subtractVector3(point, historicalReference) : null
    })
    if (points3D.some((point): point is null => point === null)) {
      trajectoryUnavailableBodyIds.push(body.id)
      return []
    }
    const completePoints = points3D as Vector3[]
    return [{ body, points3D: completePoints, points: completePoints.map((point) => ({ x: point.x, y: point.y })) }]
  })
  return { currentPositions, trajectories, trajectoryUnavailableBodyIds }
}
