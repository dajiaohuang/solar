import { covarianceProjection } from '../engine/ephemeris/covarianceProjection'
import type { GaiaSource } from './gaiaChunks'

/** Catalog-epoch positional marginal, not a propagated or systematic error model.
 * Gaia ra_error already describes alpha*cos(delta), in milliarcseconds. */
export function gaiaPositionUncertainty(source: GaiaSource) {
  if (source.ref_epoch !== 2016) return { available:false as const, reason:'unsupported-position-epoch' }
  const a = source.ra_error, d = source.dec_error, r = source.ra_dec_corr
  if ([a,d,r].some(value => value === null || value === undefined)) return { available:false as const, reason:'missing-position-uncertainty' }
  if (typeof a !== 'number' || typeof d !== 'number' || typeof r !== 'number' || ![a,d,r].every(Number.isFinite) || a < 0 || d < 0 || Math.abs(r) > 1) return { available:false as const, reason:'invalid-position-uncertainty' }
  const covarianceMasSquared = [[a*a,r*a*d],[r*a*d,d*d]]
  try {
    const ellipse = covarianceProjection(covarianceMasSquared,0,1)
    return { available:true as const, epochJulianYear:2016, timeScale:'TCB', coordinateLabels:['delta-alpha*cos(delta)','delta-dec'],
      covarianceMasSquared, majorMas:ellipse.major, minorMas:ellipse.minor,
      majorAxisDegreesFromEastTowardNorth:ellipse.major === ellipse.minor ? null : ellipse.angleRadians*180/Math.PI,
      contour:'unit-Mahalanobis', includesSystematics:false, propagated:false }
  } catch { return { available:false as const, reason:'unrepresentable-position-uncertainty' } }
}
