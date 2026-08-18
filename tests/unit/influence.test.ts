import { describe, expect, it } from 'vitest'
import { computeInfluenceRadii } from '../../src/engine/ephemeris/spheresOfInfluence'

describe('gravitational influence radii', () => {
  it('keeps Hill radius and Laplace SOI as distinct definitions', () => {
    const radii = computeInfluenceRadii(1, 0.0167, 5.97237e24, 1.98847e30)!
    expect(radii.hillRadiusAU).toBeCloseTo(0.00983, 4)
    expect(radii.laplaceSoiRadiusAU).toBeCloseTo(0.00618, 4)
    expect(radii.hillRadiusAU).not.toBe(radii.laplaceSoiRadiusAU)
  })
})
