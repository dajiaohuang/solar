import { describe, expect, it } from 'vitest'
import { dateToJulianDay, julianDayToDate } from '../../src/lib/julianDate'

describe('Julian dates', () => {
  it('maps the J2000 instant exactly', () => {
    const instant = new Date('2000-01-01T12:00:00.000Z')
    expect(dateToJulianDay(instant)).toBe(2451545)
    expect(julianDayToDate(2451545).toISOString()).toBe(instant.toISOString())
  })
})
