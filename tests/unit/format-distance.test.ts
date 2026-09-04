import { describe, expect, it } from 'vitest'
import { formatDistanceAU, formatPeriodDays } from '../../src/lib/formatDistance'

describe('formatDistanceAU', () => {
  it('uses km below .01 AU without rounding tiny values to zero', () => {
    expect(formatDistanceAU(1e-9, 'en-US')).toBe('0.149598 km')
    expect(formatDistanceAU(0.01, 'en-US')).toBe('0.01 AU')
  })

  it('uses the requested locale and rejects invalid values', () => {
    expect(formatDistanceAU(1.23456789, 'de-DE')).toBe('1,23457 AU')
    expect(formatDistanceAU(Number.NaN, 'en-US')).toBe('—')
    expect(formatDistanceAU(-1, 'en-US')).toBe('—')
  })
})

describe('formatPeriodDays', () => {
  it('uses hours below one day and days otherwise', () => {
    expect(formatPeriodDays(0.5, 'en-US')).toBe('12 h')
    expect(formatPeriodDays(1, 'en-US')).toBe('1 d')
  })

  it('rejects non-positive and non-finite values', () => {
    expect(formatPeriodDays(0, 'en-US')).toBe('—')
    expect(formatPeriodDays(Number.POSITIVE_INFINITY, 'en-US')).toBe('—')
  })
})
