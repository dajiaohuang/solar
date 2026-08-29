import { describe, expect, it } from 'vitest'
import { createPorkchopWindow } from '../../src/engine/mission/porkchopWindow'
import { dateToJulianDay } from '../../src/lib/julianDate'

describe('porkchop propagation window', () => {
  const jd = (date: string) => dateToJulianDay(new Date(`${date}T12:00:00Z`))

  it('exposes the complete propagation interval used by the worker request', () => {
    const window = createPorkchopWindow(jd('2050-06-01'), jd('2050-12-01'))
    expect(window.departureStartJd).toBe(jd('2050-06-01') - 180)
    expect(window.departureSpanDays).toBe(365)
    expect(window.minFlightDays).toBeCloseTo((jd('2050-12-01') - jd('2050-06-01')) * 0.55)
    expect(window.maxFlightDays).toBeCloseTo((jd('2050-12-01') - jd('2050-06-01')) * 1.65)
    expect(window.propagationStartJd).toBe(window.departureStartJd)
    expect(window.propagationEndJd).toBe(window.departureStartJd + window.departureSpanDays + window.maxFlightDays)
    expect(window.propagationEndJd).toBeGreaterThan(jd('2051-01-01'))
  })
})
