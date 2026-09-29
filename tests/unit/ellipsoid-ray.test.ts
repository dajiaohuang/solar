import { describe, expect, it } from 'vitest'
import { intersectEllipsoidRay } from '../../src/engine/events/ellipsoidRay'

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]

describe('single-ray triaxial ellipsoid geometry', () => {
  it('returns the first forward intercept for a centered sphere ray', () => {
    const result = intersectEllipsoidRay([1, 1, 1], identity, [10, 0, 0], [-1, 0, 0])

    expect(result.classification).toBe('intercept')
    expect(result.firstInterceptDistanceKm).toBe(9)
    expect(result.pointBodyFixedKm).toEqual([1, 0, 0])
    expect(result.pointJ2000Km).toEqual([1, 0, 0])
    expect(result.surfaceResidualScaled).toBe(0)
    expect(result.physicalUncertaintyKm).toBeNull()
  })

  it('rejects a backward ray and a forward line that misses the sphere', () => {
    const backward = intersectEllipsoidRay([1, 1, 1], identity, [10, 0, 0], [1, 0, 0])
    const miss = intersectEllipsoidRay([1, 1, 1], identity, [10, 0, 0], [-Math.sqrt(96), 2, 0])

    expect(backward.classification).toBe('miss')
    expect(backward.firstInterceptDistanceKm).toBeNull()
    expect(miss.classification).toBe('miss')
    expect(miss.firstInterceptDistanceKm).toBeNull()
  })

  it('leaves a tangent ray indeterminate inside the numerical screening margin', () => {
    const tangent = intersectEllipsoidRay([1, 1, 1], identity, [10, 0, 0], [-Math.sqrt(99), 1, 0])

    expect(tangent.classification).toBe('near-limb-indeterminate')
    expect(tangent.firstInterceptDistanceKm).toBeNull()
    expect(tangent.numericalScreeningMarginScaled).toBeGreaterThan(0)
  })

  it('rotates the first triaxial intercept back into J2000', () => {
    const j2000ToBodyFixed = [0, 1, 0, -1, 0, 0, 0, 0, 1]
    const result = intersectEllipsoidRay([2, 3, 4], j2000ToBodyFixed, [0, 10, 0], [0, -1, 0])

    expect(result.classification).toBe('intercept')
    expect(result.firstInterceptDistanceKm).toBe(8)
    expect(result.pointBodyFixedKm).toEqual([2, 0, 0])
    expect(result.pointJ2000Km).toEqual([0, 2, 0])
    expect(result.surfaceResidualScaled).toBe(0)
  })

  it('reconstructs a far-observer surface point from the perpendicular ray component', () => {
    const result = intersectEllipsoidRay([1, 1, 1], identity, [1e12, 0, 0], [-1, 5e-13, 0])

    expect(result.classification).toBe('intercept')
    expect(result.pointBodyFixedKm).not.toBeNull()
    expect(result.pointBodyFixedKm?.[0]).toBeCloseTo(Math.sqrt(0.75), 7)
    expect(result.pointBodyFixedKm?.[1]).toBeCloseTo(0.5, 7)
    expect(result.surfaceResidualScaled).not.toBeNull()
    expect(Math.abs(result.surfaceResidualScaled!)).toBeLessThan(1e-8)
  })
})
