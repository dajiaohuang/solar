import { createBodyVelocityResolver, subtractVector3 } from './ephemeris'
import { toPlanarPoint } from './referenceFrame'
import type { BodyId, CelestialBody, Vector2 } from '../types'

export function computeVelocity2D(
  body: CelestialBody,
  bodiesById: Map<BodyId, CelestialBody>,
  referenceId: BodyId,
  julianDay: number,
): Vector2 | null {
  if (!body.orbit) {
    return null
  }

  const resolve = createBodyVelocityResolver(bodiesById, julianDay)
  const dp = subtractVector3(resolve(body.id), resolve(referenceId))

  const p2d = toPlanarPoint(dp)
  const speed = Math.hypot(p2d.x, p2d.y)

  if (speed < 1e-8) {
    return null
  }

  return { x: p2d.x / speed, y: p2d.y / speed }
}
