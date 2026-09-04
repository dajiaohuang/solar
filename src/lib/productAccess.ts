import { availabilityActions } from '../state/availability-store'
import { catalogAvailability, type Availability } from './productAvailability'

export class PreviewRestrictionError extends Error {
  constructor() {
    super('Not available in this preview; use the full version. / 预览版暂不开放，请使用完整版。')
    this.name = 'PreviewRestrictionError'
  }
}

export function requireProductAccess(result: Availability) {
  if (!availabilityActions.require(result)) throw new PreviewRestrictionError()
}

export function requireCatalogAccess(operation: Parameters<typeof catalogAvailability>[0]) {
  requireProductAccess(catalogAvailability(operation))
}
