import type { CelestialBody } from '../types'

/** Build-time transport selection; scientific source/profile stays independent. */
export const SEGMENTED_WEB = typeof __SOLAR_WEB_EXECUTION__ !== 'undefined' && __SOLAR_WEB_EXECUTION__ === 'segmented'

/** Explicit user/catalog two-body models are separate from the pinned archive. */
export function isDynamicOrbitBody(body: Pick<CelestialBody, 'source' | 'isCatalogBody'>) {
  return body.source === 'custom' || body.source === 'mpcorb' || (body.source === 'jpl-sbdb' && body.isCatalogBody === true)
}
