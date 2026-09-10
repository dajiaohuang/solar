import { describe, expect, it } from 'vitest'
import { dateToJulianDay, julianDayToDate, formatJulianDayAsDate } from '../../src/lib/julianDate'

describe('Julian dates', () => {
  it('formats the UTC calendar date consistently with the simulation date input', () => {
    expect(formatJulianDayAsDate(dateToJulianDay(new Date('2000-01-01T23:59:00Z')))).toBe('2000/01/01')
  })
  it('maps the J2000 instant exactly', () => {
    const instant = new Date('2000-01-01T12:00:00.000Z')
    expect(dateToJulianDay(instant)).toBe(2451545)
    expect(julianDayToDate(2451545).toISOString()).toBe(instant.toISOString())
  })
})
