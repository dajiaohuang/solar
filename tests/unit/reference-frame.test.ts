import { describe, expect, it } from 'vitest'
import { majorBodiesById } from '../../src/data/majorBodies'
import { getSuggestedViewRadius } from '../../src/lib/referenceFrame'

describe('reference-frame view radius', () => {
  it('includes source-backed satellite fallback seeds in the local framing extent', () => {
    const eirene = majorBodiesById.get('naif:557')!
    expect(eirene.source).toBe('jpl-spk-osculating-fallback')
    expect(eirene.orbit?.model).toBe('keplerian')
    const orbit = eirene.orbit!
    if (orbit.model !== 'keplerian') throw new Error('Expected a generated Keplerian Eirene fallback seed')
    const expected = Math.max(.08, orbit.semiMajorAxisAU * (1 + orbit.eccentricity)) * 1.18
    expect(getSuggestedViewRadius(['jupiter', 'naif:557'], 'jupiter', majorBodiesById, .08)).toBeCloseTo(expected, 12)
    expect(getSuggestedViewRadius(['jupiter', 'naif:557'], 'jupiter', majorBodiesById, NaN)).toBeGreaterThan(0)
  })
  it('fits Jupiter-centered moons to their local parent-body scale', () => {
    const radius = getSuggestedViewRadius(
      ['jupiter', 'io', 'europa', 'ganymede', 'callisto'],
      'jupiter',
      majorBodiesById,
    )
    const callisto = majorBodiesById.get('callisto')!
    const orbit = callisto.orbit!
    if (orbit.model !== 'keplerian') throw new Error('Expected curated Keplerian Callisto orbit')
    const expected = orbit.semiMajorAxisAU * (1 + orbit.eccentricity) * 1.18

    expect(radius).toBeCloseTo(expected, 12)
    expect(radius).toBeLessThan(0.02)
  })

  it('keeps heliocentric cross-planet views conservatively bounded', () => {
    const radius = getSuggestedViewRadius(['mars'], 'earth', majorBodiesById)
    const earth = majorBodiesById.get('earth')!
    const mars = majorBodiesById.get('mars')!
    if (earth.orbit?.model !== 'planetaryApprox' || mars.orbit?.model !== 'planetaryApprox') {
      throw new Error('Expected planetary approximation orbits')
    }
    const expected = (
      earth.orbit.base.semiMajorAxisAU * (1 + earth.orbit.base.eccentricity)
      + mars.orbit.base.semiMajorAxisAU * (1 + mars.orbit.base.eccentricity)
    ) * 1.18

    expect(radius).toBeCloseTo(expected, 12)
  })
})
