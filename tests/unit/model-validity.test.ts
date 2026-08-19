import { describe, expect, it } from 'vitest'
import { jplApproxValidityWarning } from '../../src/engine/ephemeris/modelValidity'
import { dateToJulianDay } from '../../src/lib/julianDate'

describe('JPL approximate element validity', () => {
  it('warns outside 1800–2050 and stays quiet inside the interval', () => {
    expect(jplApproxValidityWarning(dateToJulianDay(new Date('2026-01-01T00:00:00Z')))).toBeNull()
    expect(jplApproxValidityWarning(dateToJulianDay(new Date('2100-01-01T00:00:00Z')))).toContain('outside')
  })
})
