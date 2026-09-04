import satelliteCatalog from './satelliteCatalog.json'
import { bodyNaifId } from './ephemerisTargets'
import type { CelestialBody } from '../types'

export const SATELLITE_IDENTITIES = satelliteCatalog.bodies
const byNaifId = new Map(SATELLITE_IDENTITIES.filter(entry => entry.naifId !== undefined).map(entry => [entry.naifId, entry]))
const byId = new Map(SATELLITE_IDENTITIES.map(entry => [entry.id, entry]))

export function satelliteIdentity(body: Pick<CelestialBody, 'id' | 'naifId'>) {
  const naifId = bodyNaifId(body)
  return naifId === undefined ? byId.get(body.id) : byNaifId.get(naifId)
}

/** Retain existing public scene IDs and seed models. New identities do not get
 * made-up orbital elements or physical properties when a kernel is missing. */
export function additionalSatelliteBodies(existing: CelestialBody[]): CelestialBody[] {
  const existingNumbers = new Set(existing.map(bodyNaifId).filter(id => id !== undefined))
  const existingIds = new Set(existing.map(body => body.id))
  return SATELLITE_IDENTITIES
    .filter(entry => !existingIds.has(entry.id) && (entry.naifId === undefined || !existingNumbers.has(entry.naifId)))
    .map(entry => ({
      id: entry.id, naifId: entry.naifId, name: entry.name, shortName: entry.name,
      kind: 'moon', parentId: entry.parentId, source: 'jpl-satellite-inventory',
      // Screen marker size, not a measured physical radius.
      color: '#b8c7d8', size: 2.1,
    }))
}

export function satelliteSearchTerms(body: Pick<CelestialBody, 'id' | 'naifId'>): string {
  const entry = satelliteIdentity(body)
  return entry ? [entry.name, ...entry.aliases, entry.discoveryId, entry.naifId].filter(value => value !== undefined).join(' ') : ''
}
