import { createBodyPositionResolver } from './ephemeris'
import { toPlanarPoint } from './referenceFrame'
import type { BodyId, CelestialBody, OrbitDefinition, Vector2 } from '../types'

const ELLIPSE_SAMPLES = 300

function getOrbitalPeriodDays(orbit: OrbitDefinition) {
  const semiMajorAxisAU =
    orbit.model === 'planetaryApprox' ? orbit.base.semiMajorAxisAU : orbit.semiMajorAxisAU

  return 365.25 * Math.sqrt(semiMajorAxisAU * semiMajorAxisAU * semiMajorAxisAU)
}

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

    const periodDays = getOrbitalPeriodDays(body.orbit)
    const startJulianDay = centerJulianDay - periodDays / 2
    const endJulianDay = centerJulianDay + periodDays / 2
    const points: Vector2[] = []

    for (let index = 0; index <= ELLIPSE_SAMPLES; index += 1) {
      const fraction = index / ELLIPSE_SAMPLES
      const julianDay = startJulianDay + fraction * (endJulianDay - startJulianDay)
      const resolve = createBodyPositionResolver(bodiesById, julianDay)
      const referencePosition = resolve(referenceId)
      const bodyPosition = resolve(body.id)
      const relativePosition = {
        x: bodyPosition.x - referencePosition.x,
        y: bodyPosition.y - referencePosition.y,
        z: bodyPosition.z - referencePosition.z,
      }

      points.push(toPlanarPoint(relativePosition))
    }

    ellipses.push({ body, points })
  }

  return ellipses
}
