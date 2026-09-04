import { describe, expect, it } from 'vitest'
import { parseElementLine } from '../../scripts/lib/jpl-element-inventory.mjs'

const numbered = '     1 Ceres             61200  2.7655526 0.07969230  10.58803  73.29421  80.24863 274.4193464  3.34  0.12 JPL 48'
const unnumbered = 'A/2010 LN135  55379  -2081.9705 1.00083630  64.34328 181.55862 184.91367  -0.0033687 14.05 0.15 JPL 2'
const comet = '  1P/Halley                                   39875  0.57486383 0.96793600 162.19053 112.24143  59.09895 19860208.47362 JPL 75'

describe('JPL fixed-column element parser', () => {
  it('parses numbered and unnumbered asteroid columns without whitespace splitting', () => {
    expect(parseElementLine(numbered, 'numbered-asteroid')).toMatchObject({ id: 'sb:asteroid:1', name: 'Ceres', orbit: { epochJd: 2461200.5, semiMajorAxisAU: 2.7655526, eccentricity: 0.0796923, meanAnomalyDeg: 274.4193464 }, geometryStatus: 'elliptic-elements', sourceRef: 'JPL 48' })
    expect(parseElementLine(unnumbered, 'unnumbered-asteroid')).toMatchObject({ id: 'sb:asteroid:A/2010 LN135', designation: 'A/2010 LN135', orbit: { semiMajorAxisAU: -2081.9705, eccentricity: 1.0008363 }, geometryStatus: 'open-conic-elements' })
  })

  it('uses comet q/Tp fields and preserves fragments in identity', () => {
    expect(parseElementLine(comet, 'comet')).toMatchObject({ id: 'sb:comet:1P', designation: '1P', name: '1P/Halley', orbit: { perihelionAU: 0.57486383, eccentricity: 0.967936, perihelionTimeRaw: '19860208.47362' }, geometryStatus: 'elliptic-elements', sourceRef: 'JPL 75' })
    const fragment = `${'C/2025 K1-B (ATLAS)'.padEnd(46)}60941  0.33421249 1.00203347 147.91720 271.33000  97.64116 20251008.45248 JPL 33`
    expect(parseElementLine(fragment, 'comet')).toMatchObject({ id: 'sb:comet:C/2025 K1-B', designation: 'C/2025 K1-B' })
  })

  it('ignores headers and rejects malformed nonblank fields', () => {
    expect(parseElementLine(' Num   Name', 'numbered-asteroid')).toBeNull()
    expect(parseElementLine('--------------------------------', 'comet')).toBeNull()
    expect(() => parseElementLine(numbered.replace('0.07969230', 'not-a-number'), 'numbered-asteroid')).toThrow(/eccentricity/)
  })
})
