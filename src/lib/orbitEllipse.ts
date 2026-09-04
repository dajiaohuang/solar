import { bodyPositionOrNull, createBodyPositionResolver } from './ephemeris'
import { kernelsForWindow } from '../engine/ephemeris/kernelStore'
import { getOrbitalPeriodDays } from './orbitalPeriod'
import { toPlanarPoint } from './referenceFrame'
import type { BodyId, CelestialBody, Vector2 } from '../types'

const ELLIPSE_SAMPLES = 300

export { getOrbitalPeriodDays }

export function computeOrbitEllipses(
  bodies: CelestialBody[],
  bodiesById: Map<BodyId, CelestialBody>,
  referenceId: BodyId,
  centerJulianDay: number,
) {
  const ellipses: { body: CelestialBody; points: Vector2[] }[] = []

  for (const body of bodies) {
    if (!body.orbit) {
      continue
    }

    const periodDays = getOrbitalPeriodDays(body.orbit, body.parentId ? 'parent' : 'sun')
    const startJulianDay = centerJulianDay - periodDays / 2
    const endJulianDay = centerJulianDay + periodDays / 2
    const points: Vector2[] = []
    const kernels = kernelsForWindow(startJulianDay, endJulianDay)

    for (let index = 0; index <= ELLIPSE_SAMPLES; index += 1) {
      const fraction = index / ELLIPSE_SAMPLES
      const julianDay = startJulianDay + fraction * (endJulianDay - startJulianDay)
      const resolve = createBodyPositionResolver(bodiesById, julianDay, kernels)
      const referencePosition = bodyPositionOrNull(resolve, referenceId)
      const bodyPosition = bodyPositionOrNull(resolve, body.id)
      if (!referencePosition || !bodyPosition) break
      const relativePosition = {
        x: bodyPosition.x - referencePosition.x,
        y: bodyPosition.y - referencePosition.y,
        z: bodyPosition.z - referencePosition.z,
      }

      points.push(toPlanarPoint(relativePosition))
    }

    if (points.length === ELLIPSE_SAMPLES + 1) ellipses.push({ body, points })
  }

  return ellipses
}
