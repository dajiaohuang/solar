import { describe, expect, it } from 'vitest'
import { solveEllipticKeplerRadians } from '../../src/engine/ephemeris/kepler'
import { orbitToHeliocentricVector } from '../../src/lib/ephemeris'
import type { KeplerianOrbit } from '../../src/types'

// Independent 80-decimal-digit mpmath bisection of E - e*sin(E) = M.
// Inputs are converted from the exact binary64 values, not decimal strings.
const references = [
  [1e-18, 0.999999999999, Number('8.846362663028021920092815961327332594059e-7')],
  [1e-12, 0.9999999, Number('9.99833417153809594025392758707356267904e-6')],
  [1e-6, 0.999999, Number('0.01806124662152221616916928727435872440607')],
  [0.1, 0.999, Number('0.8515505079998896110696268628007606717945')],
  [3, 0.9, Number('3.067037496630688558913036674269989956201')],
]

describe('elliptic root accuracy', () => {
  it.each(references)('matches an independent high precision root at M=%s, e=%s', (mean, eccentricity, expected) => {
    expect(Math.abs(solveEllipticKeplerRadians(mean, eccentricity) / expected - 1)).toBeLessThan(3e-14)
  })

  it('rejects invalid angles before they enter rendering geometry', () => {
    const orbit: KeplerianOrbit = { model: 'keplerian', epochJd: 2451545, semiMajorAxisAU: 1,
      eccentricity: 0.1, meanAnomalyDeg: 0, meanMotionDegPerDay: 1,
      inclinationDeg: NaN, ascendingNodeDeg: 0, argPeriapsisDeg: 0 }
    expect(() => orbitToHeliocentricVector(orbit, 2451545)).toThrow(/finite/)
  })
})
