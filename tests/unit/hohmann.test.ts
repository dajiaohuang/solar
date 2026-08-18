import { describe, expect, it } from 'vitest'
import { computeHohmann } from '../../src/engine/mission/hohmann'

describe('Hohmann transfer', () => {
  it('returns Earth-to-Mars values in km/s with outward burn direction', () => {
    const result = computeHohmann(1, 1.523679)!
    expect(result.direction).toBe('outward')
    expect(result.departureDeltaVKmS).toBeCloseTo(2.945, 2)
    expect(result.arrivalDeltaVKmS).toBeCloseTo(2.649, 2)
    expect(result.transferTimeDays).toBeCloseTo(258.9, 0)
    expect(result.totalDeltaVKmS).toBeGreaterThan(5)
  })

  it('uses negative prograde-direction burns for an inward transfer', () => {
    const result = computeHohmann(1.523679, 1)!
    expect(result.direction).toBe('inward')
    expect(result.departureDeltaVKmS).toBeLessThan(0)
    expect(result.arrivalDeltaVKmS).toBeLessThan(0)
  })
})
