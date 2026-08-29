import { describe, expect, it } from 'vitest'
import { majorBodiesById } from '../../src/data/majorBodies'
import {
  createBodyPositionResolver,
  dotVector3,
  orbitToHeliocentricVector,
  subtractVector3,
  vector3Magnitude,
} from '../../src/lib/ephemeris'

const J2000 = 2451545
const ILLUSTRATIVE_SATELLITES = ['io', 'europa', 'ganymede', 'callisto', 'titan']

function requireKeplerianBody(bodyId: string) {
  const body = majorBodiesById.get(bodyId)
  if (!body?.orbit || body.orbit.model !== 'keplerian') throw new Error(`${bodyId} must have a Keplerian orbit`)
  return { body, orbit: body.orbit }
}

describe('satellite orbit evidence', () => {
  it('uses the published JPL Moon mean elements and J2000 phase', () => {
    const { body: moon, orbit } = requireKeplerianBody('moon')
    expect(moon.source).toBe('jpl-satellite-mean')
    expect(moon.satelliteOrbitEvidence).toEqual({
      sourceFrame: 'jpl-ecliptic',
      appliedFrame: 'scene-j2000-ecliptic',
      sourceCenter: 'earth-geocenter',
      appliedCenter: 'earth-geocenter',
      centerHandling: 'de440-gm-barycentric-partition',
      epochLabel: '2000-01-01.5',
      epochTimeScale: 'TDB',
      phaseProvenance: 'jpl-mean-elements',
      precision: 'fixed-mean-ellipse-not-ephemeris',
      sourceUrl: 'https://ssd.jpl.nasa.gov/sats/elem/',
    })
    expect(orbit.epochJd).toBe(J2000)
    expect(orbit.semiMajorAxisAU).toBeCloseTo(384400 / 149597870.7, 15)
    expect(orbit.eccentricity).toBe(0.0554)
    expect(orbit.argPeriapsisDeg).toBe(318.15)
    expect(orbit.meanAnomalyDeg).toBe(135.27)
    expect(orbit.inclinationDeg).toBe(5.16)
    expect(orbit.ascendingNodeDeg).toBe(125.08)
    expect(orbit.meanMotionDegPerDay).toBeCloseTo(360 / 27.322, 12)
  })

  it('keeps the applied Moon vector within the source ellipse after barycentric partitioning', () => {
    const { body: moon, orbit } = requireKeplerianBody('moon')
    expect(moon.satelliteOrbitEvidence?.centerHandling).toBe('de440-gm-barycentric-partition')
    const inclination = orbit.inclinationDeg * Math.PI / 180
    const node = orbit.ascendingNodeDeg * Math.PI / 180
    const planeNormal = {
      x: Math.sin(inclination) * Math.sin(node),
      y: -Math.sin(inclination) * Math.cos(node),
      z: Math.cos(inclination),
    }
    const minDistance = orbit.semiMajorAxisAU * (1 - orbit.eccentricity)
    const maxDistance = orbit.semiMajorAxisAU * (1 + orbit.eccentricity)
    for (let sample = 0; sample < 24; sample += 1) {
      const julianDay = J2000 + sample * 27.322 / 24
      const local = orbitToHeliocentricVector(orbit, julianDay)
      expect(Math.abs(dotVector3(local, planeNormal))).toBeLessThan(1e-15)
      expect(vector3Magnitude(local)).toBeGreaterThanOrEqual(minDistance - 1e-15)
      expect(vector3Magnitude(local)).toBeLessThanOrEqual(maxDistance + 1e-15)

      const resolve = createBodyPositionResolver(majorBodiesById, julianDay)
      expect(vector3Magnitude(subtractVector3(resolve('moon'), resolve('earth')))).toBeCloseTo(vector3Magnitude(local), 12)
    }
  })

  it('prevents illustrative shared phases from masquerading as sourced phases', () => {
    for (const bodyId of ILLUSTRATIVE_SATELLITES) {
      const { body, orbit } = requireKeplerianBody(bodyId)
      expect(orbit.meanAnomalyDeg).toBe(0)
      expect(body.source).toBe('curated-approx')
      expect(body.satelliteOrbitEvidence).toMatchObject({
        sourceFrame: 'undocumented-illustrative',
        appliedFrame: 'scene-j2000-ecliptic',
        sourceCenter: 'undocumented-parent-center',
        appliedCenter: 'parent-rendered-point',
        centerHandling: 'direct-parent-addition',
        epochTimeScale: 'unspecified',
        phaseProvenance: 'illustrative-zero-at-epoch',
        precision: 'illustrative-fixed-ellipse',
      })
    }
  })
})
