import { describe, expect, it } from 'vitest'
import { covarianceProjection } from '../../src/engine/ephemeris/covarianceProjection'

describe('projected covariance contour', () => {
  it('preserves diagonal axes and converts units', () => {
    expect(covarianceProjection([[9, 0], [0, 4]], 0, 1, 2)).toEqual({ first: 0, second: 1, major: 6, minor: 4, angleRadians: 0 })
  })
  it('recovers a rotated analytic ellipse', () => {
    const angle = 0.7, c = Math.cos(angle), s = Math.sin(angle)
    const result = covarianceProjection([[9*c*c+4*s*s, 5*c*s], [5*c*s, 9*s*s+4*c*c]], 0, 1)
    expect(result.major).toBeCloseTo(3, 14)
    expect(result.minor).toBeCloseTo(2, 14)
    expect(result.angleRadians).toBeCloseTo(angle, 14)
  })
  it('keeps singular and zero projections without injecting variance', () => {
    expect(covarianceProjection([[1, 1], [1, 1]], 0, 1).minor).toBe(0)
    expect(covarianceProjection([[0, 0], [0, 0]], 0, 1).major).toBe(0)
  })
  it('preserves nonzero axes across extreme covariance and display scales', () => {
    for (const magnitude of [1e-200, 1e200]) {
      const result = covarianceProjection([[magnitude, 0], [0, 4 * magnitude]], 0, 1)
      expect(result.major / Math.sqrt(magnitude)).toBeCloseTo(2, 14)
      expect(result.minor / Math.sqrt(magnitude)).toBeCloseTo(1, 14)
    }
    const anisotropic = covarianceProjection([[1e-300, 0], [0, 1e300]], 0, 1)
    expect(anisotropic.major).toBe(1e150)
    expect(anisotropic.minor).toBe(1e-150)
    expect(covarianceProjection([[1e-200, 0], [0, 4e-200]], 0, 1, 1e200).minor / 1e100).toBeCloseTo(1, 14)
    const rotated = covarianceProjection([[2.5e-200, 1.5e-200], [1.5e-200, 2.5e-200]], 0, 1)
    expect(rotated.major / 1e-100).toBeCloseTo(2, 14)
    expect(rotated.minor / 1e-100).toBeCloseTo(1, 14)
  })
  it('rejects invalid axes, units and indefinite covariance', () => {
    for (const matrix of [[[1, 2], [2, 1]], [[-1, 0], [0, 1]], [[NaN, 0], [0, 1]]]) expect(() => covarianceProjection(matrix, 0, 1)).toThrow()
    expect(() => covarianceProjection([[1]], 0, 0)).toThrow()
    expect(() => covarianceProjection([[1, 0.5], [0.1, 1]], 0, 1)).toThrow()
    expect(() => covarianceProjection([[1, 0], [0, 1]], 0, 1, 0)).toThrow()
  })
})
