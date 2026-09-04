import { describe, expect, it } from 'vitest'
import { apparentPosition } from '../../src/engine/ephemeris/apparent'
import { J2000_JULIAN_DAY, utcJulianDayToEt, utcJulianDayToTdb, utcTimeScaleQuality } from '../../src/engine/ephemeris/timeScales'

describe('NAIF time-scale approximation', () => {
  it('uses the NAIF 37-second leap table at J2000 and TT=TAl+32.184', () => {
    const tdb = utcJulianDayToTdb(J2000_JULIAN_DAY)
    expect((tdb - J2000_JULIAN_DAY) * 86400).toBeCloseTo(69.184, 3)
    expect(utcJulianDayToEt(J2000_JULIAN_DAY)).toBe(tdb)
    expect(utcTimeScaleQuality(J2000_JULIAN_DAY).status).toBe('supported')
  })
  it('throws for pre-1972 UTC and marks future leap holding explicit', () => {
    expect(() => utcJulianDayToTdb(2_440_000)).toThrow(/1972/)
    expect(utcTimeScaleQuality(2_500_000).status).toBe('future-uncertain')
  })
})

const state = (position: [number, number, number], velocity: [number, number, number] = [0, 0, 0]) => () => ({ position, velocity })
describe('apparent position corrections', () => {
  it('distinguishes geometric and reception light-time positions', () => {
    const observer = state([0, 0, 0])
    const target = (jd: number) => ({ position: [100 * (jd - 2_451_545) * 86400, 0, 1_000_000] as [number, number, number], velocity: [100, 0, 0] as [number, number, number] })
    const geometric = apparentPosition({ observer, target, julianDay: 2_451_545, mode: 'geometric' })
    const corrected = apparentPosition({ observer, target, julianDay: 2_451_545, mode: 'light-time' })
    expect(geometric.position[0]).toBe(0)
    expect(corrected.lightTimeSeconds).toBeCloseTo(1_000_000 / 299_792.458, 5)
    expect(corrected.emissionJulianDay).toBeLessThan(2_451_545)
  })
  it('applies stellar aberration using observer velocity', () => {
    const result = apparentPosition({ target: state([1_000_000, 0, 0]), observer: state([0, 0, 0], [0, 29.78, 0]), julianDay: 2_451_545, mode: 'light-time+stellar-aberration' })
    expect(result.position[1]).toBeGreaterThan(0)
    expect(result.assumptions.join(' ')).toMatch(/gravitational light deflection/)
  })
})
