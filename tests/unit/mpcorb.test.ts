import { describe, expect, it } from 'vitest'
import { buildBodyId, decodePackedEpoch, decodePackedPermanentNumber, findMissingFeatured, parseMpcorbLine } from '../../scripts/preprocess-asteroids.mjs'

function fixedWidthLine() {
  const characters = Array(194).fill(' ')
  const put = (start: number, value: string) => value.split('').forEach((character, index) => { characters[start + index] = character })
  put(0, '0000001'); put(8, ' 3.34'); put(20, 'K2411'); put(26, ' 10.0000'); put(37, ' 73.0000')
  put(48, ' 80.0000'); put(59, ' 10.6000'); put(70, '0.0758000'); put(80, '0.214000000')
  put(92, ' 2.7670000'); put(161, '0000'); put(166, '1 Ceres')
  return characters.join('')
}

describe('MPCORB pipeline parser', () => {
  it('decodes packed epochs and validates fixed-width elements', () => {
    expect(decodePackedEpoch('K2411')).toBe(2460310.5)
    const parsed = parseMpcorbLine(fixedWidthLine(), 'chunk-0000')
    // Ceres is intentionally skipped because it is supplied by the curated major-body dataset.
    expect(parsed.skip).toBe(true)
  })

  it('parses a valid catalog record without rounding its orbital elements', () => {
    const parsed = parseMpcorbLine(fixedWidthLine().replace('1 Ceres', '999 Sample'), 'chunk-0042')
    expect(parsed.record).toMatchObject({
      id: 'asteroid:mpc:0000001',
      chunkId: 'chunk-0042',
      epochJd: 2460310.5,
      semiMajorAxisAU: 2.767,
      eccentricity: 0.0758,
      inclinationDeg: 10.6,
      meanMotionDegPerDay: 0.214,
    })
    expect(parsed.indexEntry?.searchKey).toContain('sample')
  })

  it('uses the packed designation as a rename-stable identity', () => {
    expect(buildBodyId('00433')).toBe('asteroid:mpc:00433')
    expect(decodePackedPermanentNumber('A0345')).toBe(100345)
    const before = parseMpcorbLine(fixedWidthLine().replace('1 Ceres', '433 Eros'))
    const after = parseMpcorbLine(fixedWidthLine().replace('1 Ceres', '433 A-New-Name'))
    expect(before.record?.id).toBe(after.record?.id)
  })

  it('makes missing curated targets a machine-checkable validation failure', () => {
    expect(findMissingFeatured(['Bennu', 'Ryugu'])).toContain('apophis')
    expect(findMissingFeatured(['Bennu', 'Ryugu'])).not.toContain('bennu')
  })

  it('rejects hyperbolic elements in the elliptic data product', () => {
    const line = fixedWidthLine().replace('1 Ceres', '999 Sample')
    const chars = line.split('')
    '1.0758000'.split('').forEach((character, index) => { chars[70 + index] = character })
    expect(parseMpcorbLine(chars.join('')).error).toBe('non-elliptic')
  })
})
