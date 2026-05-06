import { createBodyPositionResolver, subtractVector3 } from './ephemeris'
import { toPlanarPoint } from './referenceFrame'
import type { BodyId, CelestialBody, Vector2 } from '../types'

const DT = 0.5

export function computeVelocity2D(
  body: CelestialBody,
  bodiesById: Map<BodyId, CelestialBody>,
  referenceId: BodyId,
  julianDay: number,
): Vector2 | null {
  if (!body.orbit) {
    return null
  }

  const resolve = createBodyPositionResolver(bodiesById, julianDay)
  const resolve2 = createBodyPositionResolver(bodiesById, julianDay + DT)

  const refPos = resolve(referenceId)
  const refPos2 = resolve2(referenceId)

  const pos = resolve(body.id)
  const pos2 = resolve2(body.id)

  const relPos = subtractVector3(pos, refPos)
  const relPos2 = subtractVector3(pos2, refPos2)

  const dp = subtractVector3(relPos2, relPos)

  const p2d = toPlanarPoint(dp)
  const speed = Math.hypot(p2d.x, p2d.y) / DT

  if (speed < 1e-8) {
    return null
  }

  return { x: p2d.x / (speed * DT), y: p2d.y / (speed * DT) }
}
