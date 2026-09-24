import { describe, expect, it } from 'vitest'
import { catalogMaximumSpeedAUPerTtDay, catalogTemporalDisplacementAU } from '../../src/engine/ephemeris/catalogTemporalBudget'
import { prepareCatalogElements, propagatePreparedCatalogPositions } from '../../src/engine/ephemeris/catalogPoints'
import { utcJulianDayIntervalTtDays, utcJulianDayToTt, utcTimeScaleQuality } from '../../src/engine/ephemeris/timeScales'

describe('catalog temporal model displacement', () => {
  it('preserves represented UTC intervals and bounds both TT rounding paths', () => {
    // NAIF naif0012.tls: TAI-UTC changes from 36 to 37 s at 2017-JAN-1.
    // Use exactly representable UTC day endpoints, not rounded date strings.
    const midnight = 2457754.5
    for (const delta of [2 ** -31, 2 ** -20, 0.5, 1]) {
      const before = midnight - delta
      const expected = delta + 1 / 86400
      expect(utcJulianDayIntervalTtDays(before, midnight)).toBe(expected)
      expect(utcJulianDayIntervalTtDays(midnight, before)).toBe(-expected)
      const bound = catalogTemporalDisplacementAU(before, midnight, 1)!
      expect(bound).toBeGreaterThanOrEqual(expected)
      expect(bound).toBeGreaterThanOrEqual(Math.abs(utcJulianDayToTt(midnight) - utcJulianDayToTt(before)))
    }
    expect(utcJulianDayIntervalTtDays(midnight, midnight + 2 ** -31)).toBe(2 ** -31)
    expect(catalogTemporalDisplacementAU(2400000, 2400000, null)).toBeNull()
  })

  it('keeps source receipts independently owned and rejects invalid TT intervals', () => {
    const quality = utcTimeScaleQuality(2457754.5)
    const original = [...quality.sources]
    ;(quality.sources as string[]).fill('changed by receipt consumer')
    expect(utcTimeScaleQuality(2457754.5).sources).toEqual(original)
    for (const endpoint of [NaN, Infinity, -Infinity, 2400000]) {
      expect(() => utcJulianDayIntervalTtDays(endpoint, 2457754.5)).toThrow(RangeError)
      expect(() => utcJulianDayIntervalTtDays(2457754.5, endpoint)).toThrow(RangeError)
    }
  })
  it('uses source mean motion and periapsis speed, independently of adopted solar GM', () => {
    const circular = new Float64Array([2451545, 2, 0, 0, 0, 0, 0, 180 / Math.PI])
    expect(catalogMaximumSpeedAUPerTtDay(circular)).toBeCloseTo(2, 12)
    circular[2] = 0.6 // sqrt(1.6/0.4) = 2
    expect(catalogMaximumSpeedAUPerTtDay(circular)).toBeCloseTo(4, 12)
    const both = new Float64Array([...circular, 2451545, 1, 0, 0, 0, 0, 0, 0.1])
    expect(catalogMaximumSpeedAUPerTtDay(both)).toBe(catalogMaximumSpeedAUPerTtDay(circular))
  })
  it('bounds three-dimensional conic displacement across periapsis and in both time directions', () => {
    for (const e of [0, 0.6, 0.99, 0.9999]) {
      const elements = new Float64Array([2451545, 2, e, 79, 137, 241, 0, 0.3])
      const prepared = prepareCatalogElements(elements), speed = catalogMaximumSpeedAUPerTtDay(elements)!
      const at = (dt: number) => propagatePreparedCatalogPositions(prepared, 2451545 + dt, '3d', new Float64Array(3))
      for (const span of [0.0001, 0.1, 10, 100]) {
        const left = at(-span / 2), right = at(span / 2)
        expect(Math.hypot(...left.map((value, i) => value - right[i]))).toBeLessThanOrEqual(speed * span * (1 + 1e-5))
      }
    }
  })
  it('includes the TT offset change across the 2017 UTC leap boundary and refuses historical reuse', () => {
    const midnight = 2457754.5, before = midnight - 1 / 86400
    const bound = catalogTemporalDisplacementAU(before, midnight, 86400)!
    expect(bound).toBeCloseTo(2, 3)
    expect(catalogTemporalDisplacementAU(midnight, before, 86400)).toBe(bound)
    expect(catalogTemporalDisplacementAU(2400000, 2400001, 1)).toBeNull()
    expect(catalogTemporalDisplacementAU(midnight, midnight, null)).toBe(0)
  })
  it('disables reuse for unsupported or unrepresentable motion', () => {
    for (const [a, e, n] of [[-1, 0, 1], [1, 1, 1], [1, 0, 0], [1, NaN, 1], [Number.MAX_VALUE, 0.9, Number.MAX_VALUE]]) {
      expect(catalogMaximumSpeedAUPerTtDay(new Float64Array([2451545, a, e, 0, 0, 0, 0, n]))).toBeNull()
    }
    expect(catalogTemporalDisplacementAU(2451545, 2451546, null)).toBeNull()
  })
})
