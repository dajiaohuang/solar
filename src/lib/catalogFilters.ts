import type { AsteroidRecord, CatalogFilters } from '../types'
import { normalizeSearchText } from './catalogLoader'

export const CATALOG_ORBIT_CLASS_FILTERS = ['all', 'MBA', 'MCR', 'APO', 'ATE', 'AMO', 'ATI', 'HUN', 'HIL', 'JTA', 'TNO', 'OTHER'] as const

export function createCatalogFieldMatcher(filters: CatalogFilters) {
  const query = normalizeSearchText(filters.query)
  return (
    searchKey: string,
    orbitClassCode: string,
    absoluteMagnitude: number | undefined,
    semiMajorAxisAU: number,
    eccentricity: number,
    inclinationDeg: number,
  ) => {
    const perihelion = semiMajorAxisAU * (1 - eccentricity)
    const magnitudeKnown = absoluteMagnitude !== undefined
    const magnitudeMatches = filters.magnitudeStatus === 'unknown'
      ? !magnitudeKnown
      : filters.magnitudeStatus === 'known'
        ? magnitudeKnown && absoluteMagnitude! >= filters.absoluteMagnitude[0] && absoluteMagnitude! <= filters.absoluteMagnitude[1]
        : !magnitudeKnown || (absoluteMagnitude! >= filters.absoluteMagnitude[0] && absoluteMagnitude! <= filters.absoluteMagnitude[1])
    return (!query || searchKey.includes(query)) &&
      (filters.orbitClass === 'all' || orbitClassCode === filters.orbitClass) &&
      semiMajorAxisAU >= filters.semiMajorAxis[0] && semiMajorAxisAU <= filters.semiMajorAxis[1] &&
      eccentricity >= filters.eccentricity[0] && eccentricity <= filters.eccentricity[1] &&
      inclinationDeg >= filters.inclination[0] && inclinationDeg <= filters.inclination[1] &&
      magnitudeMatches &&
      perihelion >= filters.perihelion[0] && perihelion <= filters.perihelion[1]
  }
}

export function matchesCatalogRecord(record: AsteroidRecord, filters: CatalogFilters) {
  return createCatalogFieldMatcher(filters)(
    record.searchKey,
    record.orbitClassCode,
    record.absoluteMagnitude,
    record.semiMajorAxisAU,
    record.eccentricity,
    record.inclinationDeg,
  )
}

export function filterCatalogRecords(records: AsteroidRecord[], filters: CatalogFilters) {
  const matches = createCatalogFieldMatcher(filters)
  return records.filter((record) => matches(
    record.searchKey,
    record.orbitClassCode,
    record.absoluteMagnitude,
    record.semiMajorAxisAU,
    record.eccentricity,
    record.inclinationDeg,
  ))
}
