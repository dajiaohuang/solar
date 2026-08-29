import { describe, expect, it } from 'vitest'
import {
  UnsupportedOrbitError,
  createBodyPositionResolver,
  createBodyVelocityResolver,
  orbitToHeliocentricVector,
  scaleVector3,
  solveKeplerEquation,
  subtractVector3,
  vector3Magnitude,
} from '../../src/lib/ephemeris'
import {
  EARTH_MOON_GRAVITATIONAL_PARAMETERS,
  EARTH_MOON_MASS_FRACTIONS,
  partitionEarthMoonBarycenter,
} from '../../src/engine/ephemeris/earthMoonSystem'
import { majorBodiesById } from '../../src/data/majorBodies'
import { getRelativePositions } from '../../src/lib/referenceFrame'
import { buildCurrentPositions } from '../../src/lib/trajectory'
import type { CelestialBody } from '../../src/types'

const circularOrbit = {
  model: 'keplerian' as const,
  epochJd: 2451545,
  semiMajorAxisAU: 1,
  eccentricity: 0,
  inclinationDeg: 0,
  ascendingNodeDeg: 0,
  argPeriapsisDeg: 0,
  meanAnomalyDeg: 0,
  meanMotionDegPerDay: 1,
}

describe('elliptic propagation', () => {
  it('solves Kepler equation and positions a circular orbit', () => {
    expect(solveKeplerEquation(180, 0.2)).toBeCloseTo(180, 8)
    expect(orbitToHeliocentricVector(circularOrbit, 2451545)).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('explicitly rejects parabolic and hyperbolic elements', () => {
    expect(() => orbitToHeliocentricVector({ ...circularOrbit, eccentricity: 1 }, 2451545))
      .toThrow(UnsupportedOrbitError)
  })

  it('resolves parent bodies once and transforms reference frames', () => {
    const sun: CelestialBody = { id: 'sun', name: 'Sun', kind: 'star', color: '#fff', size: 1, source: 'custom' }
    const earth: CelestialBody = { id: 'earth', name: 'Earth', kind: 'planet', color: '#fff', size: 1, source: 'custom', orbit: circularOrbit }
    const moon: CelestialBody = { id: 'moon', name: 'Moon', kind: 'moon', color: '#fff', size: 1, source: 'custom', parentId: 'earth', orbit: { ...circularOrbit, semiMajorAxisAU: 0.01 } }
    const map = new Map([sun, earth, moon].map((body) => [body.id, body]))
    const resolve = createBodyPositionResolver(map, 2451545)
    const [relativeMoon] = getRelativePositions([moon], 'earth', resolve)
    expect(relativeMoon.position.x).toBeCloseTo(0.01, 10)
    expect(relativeMoon.position.y).toBeCloseTo(0, 10)
  })
})

function vectorDifferenceMagnitude(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }) {
  return vector3Magnitude(subtractVector3(left, right))
}

describe('Earth-Moon barycentric composition', () => {
  it('uses the exact DE440 gravitational parameters and complementary mass fractions', () => {
    const parameters = EARTH_MOON_GRAVITATIONAL_PARAMETERS
    expect(parameters.earthKm3PerS2).toBe(398600.43550702266)
    expect(parameters.moonKm3PerS2).toBe(4902.8001184575496)
    expect(parameters.systemKm3PerS2).toBe(403503.2356254802)
    expect(Math.abs(parameters.earthKm3PerS2 + parameters.moonKm3PerS2 - parameters.systemKm3PerS2)).toBeLessThan(1e-9)
    expect(EARTH_MOON_MASS_FRACTIONS.moon).toBeCloseTo(0.012150584395829193, 15)
    expect(EARTH_MOON_MASS_FRACTIONS.earth).toBeCloseTo(0.9878494156041708, 15)
    expect(Math.abs(EARTH_MOON_MASS_FRACTIONS.earth + EARTH_MOON_MASS_FRACTIONS.moon - 1)).toBeLessThan(1e-15)
  })

  it.each([2451545, 2451545 + 27.322])('preserves the EMB and geocentric Moon vector at JD %s', (julianDay) => {
    const earth = majorBodiesById.get('earth')!
    const moon = majorBodiesById.get('moon')!
    const emb = orbitToHeliocentricVector(earth.orbit!, julianDay)
    const earthToMoon = orbitToHeliocentricVector(moon.orbit!, julianDay)
    const expected = partitionEarthMoonBarycenter(emb, earthToMoon)
    const resolve = createBodyPositionResolver(majorBodiesById, julianDay)
    const earthGeocenter = resolve('earth')
    const moonCenter = resolve('moon')
    const reconstructedEmb = {
      x: EARTH_MOON_MASS_FRACTIONS.earth * earthGeocenter.x + EARTH_MOON_MASS_FRACTIONS.moon * moonCenter.x,
      y: EARTH_MOON_MASS_FRACTIONS.earth * earthGeocenter.y + EARTH_MOON_MASS_FRACTIONS.moon * moonCenter.y,
      z: EARTH_MOON_MASS_FRACTIONS.earth * earthGeocenter.z + EARTH_MOON_MASS_FRACTIONS.moon * moonCenter.z,
    }

    expect(vectorDifferenceMagnitude(earthGeocenter, expected.earthGeocenter)).toBeLessThan(1e-14)
    expect(vectorDifferenceMagnitude(moonCenter, expected.moonCenter)).toBeLessThan(1e-14)
    expect(vectorDifferenceMagnitude(reconstructedEmb, emb)).toBeLessThan(1e-14)
    expect(vectorDifferenceMagnitude(subtractVector3(moonCenter, earthGeocenter), earthToMoon)).toBeLessThan(1e-14)
    expect(Math.abs(
      vectorDifferenceMagnitude(earthGeocenter, emb) -
      EARTH_MOON_MASS_FRACTIONS.moon * vector3Magnitude(earthToMoon),
    )).toBeLessThan(1e-14)
  })

  it('propagates the corrected positions through current and translated reference frames', () => {
    const julianDay = 2451545
    const earth = majorBodiesById.get('earth')!
    const moon = majorBodiesById.get('moon')!
    const earthToMoon = orbitToHeliocentricVector(moon.orbit!, julianDay)
    const frame = buildCurrentPositions({
      bodies: [earth, moon],
      bodiesById: majorBodiesById,
      referenceId: 'earth',
      julianDay,
    })
    const earthPosition = frame.currentPositions.find((item) => item.body.id === 'earth')!.position3D!
    const moonPosition = frame.currentPositions.find((item) => item.body.id === 'moon')!.position3D!
    expect(vector3Magnitude(earthPosition)).toBeLessThan(1e-15)
    expect(vectorDifferenceMagnitude(moonPosition, earthToMoon)).toBeLessThan(1e-14)

    const resolve = createBodyPositionResolver(majorBodiesById, julianDay)
    const [earthFromMoon] = getRelativePositions([earth], 'moon', resolve)
    expect(vectorDifferenceMagnitude(earthFromMoon.position, scaleVector3(earthToMoon, -1))).toBeLessThan(1e-14)
  })

  it('preserves the EMB velocity under the shared finite-difference resolver', () => {
    const julianDay = 2451545
    const stepDays = 0.01
    const earth = majorBodiesById.get('earth')!
    const before = orbitToHeliocentricVector(earth.orbit!, julianDay - stepDays)
    const after = orbitToHeliocentricVector(earth.orbit!, julianDay + stepDays)
    const embVelocity = scaleVector3(subtractVector3(after, before), 1 / (2 * stepDays))
    const resolveVelocity = createBodyVelocityResolver(majorBodiesById, julianDay, stepDays)
    const earthVelocity = resolveVelocity('earth')
    const moonVelocity = resolveVelocity('moon')
    const reconstructedVelocity = {
      x: EARTH_MOON_MASS_FRACTIONS.earth * earthVelocity.x + EARTH_MOON_MASS_FRACTIONS.moon * moonVelocity.x,
      y: EARTH_MOON_MASS_FRACTIONS.earth * earthVelocity.y + EARTH_MOON_MASS_FRACTIONS.moon * moonVelocity.y,
      z: EARTH_MOON_MASS_FRACTIONS.earth * earthVelocity.z + EARTH_MOON_MASS_FRACTIONS.moon * moonVelocity.z,
    }
    expect(vectorDifferenceMagnitude(reconstructedVelocity, embVelocity)).toBeLessThan(1e-12)
  })

  it('fails closed when an EMB seed omits its required Moon orbit', () => {
    const earth: CelestialBody = {
      id: 'earth', name: 'Earth', kind: 'planet', color: '#fff', size: 1, source: 'custom',
      orbitRepresents: 'earth-moon-barycenter', positionRepresents: 'earth-geocenter', orbit: circularOrbit,
    }
    expect(() => createBodyPositionResolver(new Map([['earth', earth]]), 2451545)('earth'))
      .toThrow(/Earth-centered Moon orbit/)
  })
})
