import { describe, expect, it } from 'vitest'
import { majorBodiesById } from '../../src/data/majorBodies'
import { JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS, jplHorizonsEpochQueryUrl } from '../../src/data/satelliteEpochElements'
import { createBodyPositionResolver, dotVector3, orbitToHeliocentricVector, subtractVector3, vector3Magnitude } from '../../src/lib/ephemeris'

const J2000 = 2451545
const GIANT_SATELLITES = ['io', 'europa', 'ganymede', 'callisto', 'titan'] as const
const EXPECTED_HORIZONS = {
  io: { a: 0.002821139295029148, e: 0.004715688921345897, i: 2.212617763556377, node: 336.8524452085695, periapsis: 66.16488500283468, anomaly: 335.153206478952, motion: 203.2295710817172, period: 1.771395757437516, position: [0.00267192463675603, 0.0008640941902565209, 0.00007127946422889783] },
  europa: { a: 0.004487019063502094, e: 0.009812823575576082, i: 1.790971209716447, node: 332.6287323572119, periapsis: 254.6471423731226, anomaly: 345.411036769848, motion: 101.3169477820738, period: 3.553206130669637, position: [-0.003751687581655737, -0.002379800306952886, -0.000120015729870802] },
  ganymede: { a: 0.007155833676042577, e: 0.001457215292672099, i: 2.214148041848081, node: 343.1728455275238, periapsis: 319.8078127226449, anomaly: 277.0487684461206, motion: 50.30834975743021, period: 7.155869785747252, position: [-0.00549035284404152, -0.004581541308862496, -0.0002310042060535515] },
  callisto: { a: 0.01258555984162885, e: 0.007439434600948234, i: 2.016916220859312, node: 337.9426103461244, periapsis: 16.12689497888475, anomaly: 85.11888858079212, motion: 21.5683527268963, period: 16.69112168919004, position: [0.002173023781100756, 0.01238159356837502, 0.0004328588775702288] },
  titan: { a: 0.00816812963443584, e: 0.02860066256432539, i: 27.71833887311165, node: 169.2391602866279, periapsis: 164.4091285733822, anomaly: 163.4361974944248, motion: 22.57428702984641, period: 15.94734750754382, position: [-0.006328986729681305, 0.005126196169184979, -0.002025162432185849] },
} as const

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
      sourceFrame: 'jpl-ecliptic', appliedFrame: 'scene-j2000-ecliptic', sourceCenter: 'earth-geocenter', appliedCenter: 'earth-geocenter',
      centerHandling: 'de440-gm-barycentric-partition', epochLabel: '2000-01-01.5', epochTimeScale: 'TDB',
      phaseProvenance: 'jpl-mean-elements', precision: 'fixed-mean-ellipse-not-ephemeris', sourceUrl: 'https://ssd.jpl.nasa.gov/sats/elem/',
    })
    expect(orbit).toMatchObject({ epochJd: J2000, eccentricity: 0.0554, inclinationDeg: 5.16, ascendingNodeDeg: 125.08, argPeriapsisDeg: 318.15, meanAnomalyDeg: 135.27 })
    expect(orbit.semiMajorAxisAU).toBeCloseTo(384400 / 149597870.7, 15)
    expect(orbit.meanMotionDegPerDay).toBeCloseTo(360 / 27.322, 12)
  })

  it('keeps the applied Moon vector within the source ellipse after barycentric partitioning', () => {
    const { body: moon, orbit } = requireKeplerianBody('moon')
    expect(moon.satelliteOrbitEvidence?.centerHandling).toBe('de440-gm-barycentric-partition')
    const inclination = orbit.inclinationDeg * Math.PI / 180
    const node = orbit.ascendingNodeDeg * Math.PI / 180
    const planeNormal = { x: Math.sin(inclination) * Math.sin(node), y: -Math.sin(inclination) * Math.cos(node), z: Math.cos(inclination) }
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

  it('pins parent-centered Horizons ECLIPJ2000 elements and sourced epoch phases', () => {
    for (const bodyId of GIANT_SATELLITES) {
      const expected = EXPECTED_HORIZONS[bodyId]
      const row = JPL_HORIZONS_GIANT_SATELLITE_ELEMENTS[bodyId]
      const { body, orbit } = requireKeplerianBody(bodyId)
      expect(body.source).toBe('horizons')
      expect(orbit).toMatchObject({ epochJd: J2000, semiMajorAxisAU: expected.a, eccentricity: expected.e, inclinationDeg: expected.i, ascendingNodeDeg: expected.node, argPeriapsisDeg: expected.periapsis, meanAnomalyDeg: expected.anomaly, meanMotionDegPerDay: expected.motion })
      expect(row).toMatchObject({ sourceEphemeris: bodyId === 'titan' ? 'sat441l' : 'jup365_merged', centerCode: bodyId === 'titan' ? '500@699' : '500@599' })
      const queryUrl = jplHorizonsEpochQueryUrl(bodyId)
      expect(queryUrl).toContain(`COMMAND=%27${row.targetCode}%27`)
      expect(queryUrl).toContain(`CENTER=%27${encodeURIComponent(row.centerCode)}%27`)
      expect(queryUrl).toContain('START_TIME=%27JD2451545.0%27')
      expect(body.satelliteOrbitEvidence).toMatchObject({
        sourceFrame: 'jpl-ecliptic', appliedFrame: 'scene-j2000-ecliptic', sourceCenter: 'planet-center', appliedCenter: 'parent-rendered-point',
        centerHandling: 'direct-parent-addition', epochLabel: 'JD 2451545.0', epochTimeScale: 'TDB',
        phaseProvenance: 'jpl-horizons-osculating-elements', precision: 'fixed-osculating-ellipse-at-epoch-not-ephemeris',
        sourceUrl: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
        sourceQueryUrl: queryUrl,
      })
      expect(expected.anomaly).not.toBe(0)
      expect(360 / orbit.meanMotionDegPerDay).toBeCloseTo(expected.period, 12)
    }
    expect(new Set(GIANT_SATELLITES.map((bodyId) => requireKeplerianBody(bodyId).orbit.meanAnomalyDeg)).size).toBe(GIANT_SATELLITES.length)
  })

  it('replays the Horizons epoch vectors, orbital planes, distances and periods', () => {
    for (const bodyId of GIANT_SATELLITES) {
      const expected = EXPECTED_HORIZONS[bodyId]
      const { body, orbit } = requireKeplerianBody(bodyId)
      if (!body.parentId) throw new Error(`Missing parent for ${bodyId}`)
      const epochVector = orbitToHeliocentricVector(orbit, J2000)
      expect(epochVector.x).toBeCloseTo(expected.position[0], 11)
      expect(epochVector.y).toBeCloseTo(expected.position[1], 11)
      expect(epochVector.z).toBeCloseTo(expected.position[2], 11)
      const resolve = createBodyPositionResolver(majorBodiesById, J2000)
      const parentRelative = subtractVector3(resolve(bodyId), resolve(body.parentId))
      expect(parentRelative.x).toBeCloseTo(expected.position[0], 11)
      expect(parentRelative.y).toBeCloseTo(expected.position[1], 11)
      expect(parentRelative.z).toBeCloseTo(expected.position[2], 11)
      const inclination = orbit.inclinationDeg * Math.PI / 180
      const node = orbit.ascendingNodeDeg * Math.PI / 180
      const planeNormal = { x: Math.sin(inclination) * Math.sin(node), y: -Math.sin(inclination) * Math.cos(node), z: Math.cos(inclination) }
      const minDistance = orbit.semiMajorAxisAU * (1 - orbit.eccentricity)
      const maxDistance = orbit.semiMajorAxisAU * (1 + orbit.eccentricity)
      for (let sample = 0; sample < 24; sample += 1) {
        const vector = orbitToHeliocentricVector(orbit, J2000 + expected.period * sample / 24)
        expect(Math.abs(dotVector3(vector, planeNormal))).toBeLessThan(1e-14)
        expect(vector3Magnitude(vector)).toBeGreaterThanOrEqual(minDistance - 1e-14)
        expect(vector3Magnitude(vector)).toBeLessThanOrEqual(maxDistance + 1e-14)
      }
      const replay = orbitToHeliocentricVector(orbit, J2000 + expected.period)
      expect(replay.x).toBeCloseTo(epochVector.x, 11)
      expect(replay.y).toBeCloseTo(epochVector.y, 11)
      expect(replay.z).toBeCloseTo(epochVector.z, 11)
    }
  })
})
