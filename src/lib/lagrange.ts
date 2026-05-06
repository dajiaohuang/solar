import type { CelestialBody, Vector2 } from '../types'

// Planet masses relative to Sun mass (approximate)
export const MASS_RATIOS: Record<string, number> = {
  mercury: 1.66e-7,
  venus: 2.45e-6,
  earth: 3.0e-6,
  mars: 3.23e-7,
  jupiter: 9.55e-4,
  saturn: 2.86e-4,
  uranus: 4.36e-5,
  neptune: 5.15e-5,
}

export type LagrangePoint = {
  label: string
  position: Vector2
  color: string
}

export function computeLagrangePoints(
  planet: CelestialBody,
  planetPosition: Vector2,
): LagrangePoint[] {
  const mu = MASS_RATIOS[planet.id]
  if (mu === undefined) {
    return []
  }

  const R = Math.hypot(planetPosition.x, planetPosition.y)
  if (R < 1e-6) {
    return []
  }

  const ux = planetPosition.x / R
  const uy = planetPosition.y / R

  const rL1 = R * (1 - Math.cbrt(mu / 3))
  const rL2 = R * (1 + Math.cbrt(mu / 3))
  const rL3 = -R * (1 - (5 * mu) / 12)

  const l1 = { x: ux * rL1, y: uy * rL1 }
  const l2 = { x: ux * rL2, y: uy * rL2 }
  const l3 = { x: ux * rL3, y: uy * rL3 }

  const cos60 = Math.cos(Math.PI / 3)
  const sin60 = Math.sin(Math.PI / 3)

  const l4 = {
    x: planetPosition.x * cos60 - planetPosition.y * sin60,
    y: planetPosition.x * sin60 + planetPosition.y * cos60,
  }

  const l5 = {
    x: planetPosition.x * cos60 + planetPosition.y * sin60,
    y: -planetPosition.x * sin60 + planetPosition.y * cos60,
  }

  return [
    { label: 'L1', position: l1, color: '#ffcc44' },
    { label: 'L2', position: l2, color: '#ff9944' },
    { label: 'L3', position: l3, color: '#ff6644' },
    { label: 'L4', position: l4, color: '#44ccff' },
    { label: 'L5', position: l5, color: '#44ff88' },
  ]
}
