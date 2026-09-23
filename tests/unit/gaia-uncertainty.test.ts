import { test, expect } from 'vitest'
import { gaiaPositionUncertainty } from '../../src/lib/gaiaUncertainty'
import type { GaiaSource } from '../../src/lib/gaiaChunks'
import chunk from '../fixtures/gaia-pleiades-20260923/r11-d22.json'
const source = chunk.sources[0] as GaiaSource

test('analytic correlated position ellipse respects Gaia tangent-plane units', () => {
  const result=gaiaPositionUncertainty({...source,dec:89,ra_error:2,dec_error:2,ra_dec_corr:0.5})
  expect(result.available).toBe(true)
  if (!result.available) return
  expect(result.covarianceMasSquared).toEqual([[4,2],[2,4]])
  expect(result.majorMas).toBeCloseTo(Math.sqrt(6),14)
  expect(result.minorMas).toBeCloseTo(Math.sqrt(2),14)
  expect(result.majorAxisDegreesFromEastTowardNorth).toBeCloseTo(45,12)
  expect(result.includesSystematics).toBe(false); expect(result.propagated).toBe(false)
})
test('missing, degenerate and invalid source errors remain explicit', () => {
  expect(gaiaPositionUncertainty({...source,ref_epoch:2026}).available).toBe(false)
  expect(gaiaPositionUncertainty({...source,ra_error:null}).available).toBe(false)
  expect(gaiaPositionUncertainty({...source,ra_dec_corr:1.01}).available).toBe(false)
  const circle=gaiaPositionUncertainty({...source,ra_error:2,dec_error:2,ra_dec_corr:0})
  expect(circle.available && circle.majorAxisDegreesFromEastTowardNorth).toBeNull()
  const line=gaiaPositionUncertainty({...source,ra_error:2,dec_error:2,ra_dec_corr:1})
  expect(line.available && line.minorMas).toBe(0)
  expect(gaiaPositionUncertainty({...source,ra_error:1e300}).available).toBe(false)
})
test('real Gaia marginal preserves variance trace and determinant', () => {
  const result=gaiaPositionUncertainty(source)
  expect(result.available).toBe(true)
  if (!result.available) return
  const a=source.ra_error as number,d=source.dec_error as number,r=source.ra_dec_corr as number
  expect(result.majorMas**2+result.minorMas**2).toBeCloseTo(a*a+d*d,14)
  expect((result.majorMas*result.minorMas)**2).toBeCloseTo((a*d)**2*(1-r*r),14)
})
