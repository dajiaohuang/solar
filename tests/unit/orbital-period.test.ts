import { describe, expect, it } from 'vitest'
import { majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import { computeOrbitEllipses } from '../../src/lib/orbitEllipse'
import { getOrbitalPeriodDays } from '../../src/lib/orbitalPeriod'

function requireOrbit(bodyId: string) {
  const body = majorBodiesById.get(bodyId)
  if (!body?.orbit) throw new Error(`Missing test orbit for ${bodyId}`)
  return { body, orbit: body.orbit }
}

describe('modeled orbital periods', () => {
  // The regression values come from the curated mean motions. Primary-source
  // comparison for satellite mean elements: https://ssd.jpl.nasa.gov/sats/elem/
  it.each([
    ['moon', 27.322],
    ['io', 1.7691287041132242],
    ['titan', 15.943312666076174],
  ])('uses declared parent-centered mean motion for %s', (bodyId, expectedDays) => {
    const { body, orbit } = requireOrbit(bodyId)
    const center = body.parentId ? 'parent' : 'sun'

    expect(center).toBe('parent')
    expect(getOrbitalPeriodDays(orbit, center)).toBeCloseTo(expectedDays, 10)
  })

  it('uses the declared mean motion for heliocentric Keplerian bodies too', () => {
    const { body, orbit } = requireOrbit('ceres')
    if (orbit.model !== 'keplerian') throw new Error('Ceres must use Keplerian elements')

    const center = body.parentId ? 'parent' : 'sun'
    expect(center).toBe('sun')
    expect(getOrbitalPeriodDays(orbit, center)).toBeCloseTo(360 / orbit.meanMotionDegPerDay, 10)
  })

  it('keeps the solar two-body approximation for planetary elements', () => {
    const { orbit } = requireOrbit('earth')
    if (orbit.model !== 'planetaryApprox') throw new Error('Earth must use planetary approximation elements')

    const solarTwoBodyDays = 365.2568983 * Math.sqrt(orbit.base.semiMajorAxisAU ** 3)
    expect(getOrbitalPeriodDays(orbit, 'sun')).toBeCloseTo(solarTwoBodyDays, 10)
  })

  it('samples a complete parent-centered satellite orbit', () => {
    const { body: moon, orbit } = requireOrbit('moon')
    if (orbit.model !== 'keplerian') throw new Error('Moon must use Keplerian elements')

    const [ellipse] = computeOrbitEllipses(
      [moon],
      new Map(majorBodies.map((body) => [body.id, body])),
      'earth',
      orbit.epochJd,
    )
    const first = ellipse.points[0]
    const quarter = ellipse.points[75]
    const last = ellipse.points.at(-1)!

    expect(ellipse.points).toHaveLength(301)
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(1e-10)
    expect(Math.hypot(quarter.x - first.x, quarter.y - first.y)).toBeGreaterThan(0.001)
  })
})
