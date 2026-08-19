import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/jpl-horizons-events.json'
import { majorBodies } from '../../src/data/majorBodies'
import { adaptiveEventSampleCount } from '../../src/engine/events/eventSampling'
import { findSampledExtrema, refineBracketedExtremum } from '../../src/engine/events/sampledExtrema'
import { createBodyPositionResolver, subtractVector3, vector3Magnitude } from '../../src/lib/ephemeris'

describe('JPL Horizons event fixture', () => {
  it('keeps the exploratory Earth perihelion within the declared model tolerance', () => {
    const expected = fixture.events[0]
    const bodiesById = new Map(majorBodies.map((body) => [body.id, body]))
    const samples = adaptiveEventSampleCount([bodiesById.get('earth')!], 20)
    const start = expected.julianDayTdb - 10
    const julianDays = Array.from({ length: samples }, (_, index) => start + index / (samples - 1) * 20)
    const distances = julianDays.map((julianDay) => {
      const resolve = createBodyPositionResolver(bodiesById, julianDay)
      return vector3Magnitude(subtractVector3(resolve('earth'), resolve('sun')))
    })
    const candidate = findSampledExtrema(distances, 'minimum')
      .sort((left, right) => Math.abs(julianDays[left.sampleIndex] - expected.julianDayTdb) - Math.abs(julianDays[right.sampleIndex] - expected.julianDayTdb))[0]
    expect(candidate).toBeDefined()
    const refined = refineBracketedExtremum(
      julianDays[candidate.sampleIndex - 1],
      julianDays[candidate.sampleIndex + 1],
      'minimum',
      (julianDay) => {
        const resolve = createBodyPositionResolver(bodiesById, julianDay)
        return vector3Magnitude(subtractVector3(resolve('earth'), resolve('sun')))
      },
    )
    expect(Math.abs(refined.julianDay - expected.julianDayTdb)).toBeLessThan(expected.timeToleranceDays)
    expect(Math.abs(refined.value - expected.distanceAu)).toBeLessThan(expected.distanceToleranceAu)
  })

  it('increases cadence for fast satellite motion', () => {
    const earth = majorBodies.find((body) => body.id === 'earth')!
    const moon = majorBodies.find((body) => body.id === 'moon')!
    expect(adaptiveEventSampleCount([earth, moon], 365)).toBeGreaterThan(adaptiveEventSampleCount([earth], 365))
  })
})
