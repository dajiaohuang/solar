import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/sbdb-bennu.json'
import { parseSbdbBody, type SbdbResponse } from '../../src/data/loaders/sbdb'
import { asteroidRecordToBody } from '../../src/lib/catalogLoader'
import { getInstantaneousElements } from '../../src/lib/ephemeris'
import { utcJulianDayToTdb } from '../../src/engine/ephemeris/timeScales'
import type { AsteroidRecord } from '../../src/types'
import { majorBodies } from '../../src/data/majorBodies'

describe('source orbital time scales', () => {
  it('propagates every sourced named satellite in its declared TDB scale', () => {
    const satellites = majorBodies.filter(body => body.satelliteOrbitEvidence?.epochTimeScale === 'TDB')
    expect(satellites.length).toBeGreaterThanOrEqual(6)
    for (const body of satellites) {
      if (body.orbit?.model !== 'keplerian') throw new Error('Expected sourced satellite ellipse')
      expect(body.orbit.epochTimeScale, body.id).toBe('TDB')
    }
  })
  it('evaluates JPL planetary secular rates at JDTDB as specified by the source table', () => {
    const orbit = majorBodies.find(body => body.id === 'mercury')!.orbit!
    if (orbit.model !== 'planetaryApprox') throw new Error('Expected JPL table orbit')
    const utcJd = 2461288.5
    const centuries = (utcJulianDayToTdb(utcJd) - 2451545) / 36525
    const meanAnomaly = orbit.base.meanLongitudeDeg - orbit.base.longitudeOfPerihelionDeg +
      (orbit.rates.meanLongitudeDeg - orbit.rates.longitudeOfPerihelionDeg) * centuries
    expect(getInstantaneousElements(orbit, utcJd).meanAnomalyDeg).toBeCloseTo((meanAnomaly % 360 + 360) % 360, 9)
  })

  it('propagates SBDB elements in TDB instead of subtracting a UTC date from their epoch', () => {
    const body = parseSbdbBody(fixture as SbdbResponse, 'Bennu')
    if (body.orbit?.model !== 'keplerian') throw new Error('Expected SBDB elements')
    const utcJd = 2461288.5
    const expected = (body.orbit.meanAnomalyDeg + body.orbit.meanMotionDegPerDay *
      (utcJulianDayToTdb(utcJd) - body.orbit.epochJd)) % 360
    expect(getInstantaneousElements(body.orbit, utcJd).meanAnomalyDeg).toBeCloseTo((expected + 360) % 360, 10)
    expect(body.orbit.epochTimeScale).toBe('TDB')
  })

  it('preserves MPCORB TT epochs and advances by TT minus UTC before propagation', () => {
    // MPC column 21-25 is TT. IERS C 72 + TT-TAI gives 37 + 32.184 s.
    const record: AsteroidRecord = { id: 'asteroid:test', label: 'Test', shortLabel: 'Test',
      searchKey: 'test', chunkId: '0', orbitClassCode: 'MBA', orbitClassName: 'Main belt',
      isNeo: false, isPha: false, epochJd: 2461288.5, semiMajorAxisAU: 2,
      eccentricity: .2, inclinationDeg: 5, ascendingNodeDeg: 20, argPeriapsisDeg: 30,
      meanAnomalyDeg: 0, meanMotionDegPerDay: 1 }
    const body = asteroidRecordToBody(record)
    if (body.orbit?.model !== 'keplerian') throw new Error('Expected MPCORB elements')
    expect(getInstantaneousElements(body.orbit, record.epochJd).meanAnomalyDeg).toBeCloseTo(69.184 / 86400, 9)
    expect(body.orbit.epochJd).toBe(record.epochJd)
    expect(body.orbit.epochTimeScale).toBe('TT')
    expect(body.dataEpochLabel).toContain('TT')
  })
})
