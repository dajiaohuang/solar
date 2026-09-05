import { bodyNaifId } from '../data/ephemerisTargets'
import type { CelestialBody } from '../types'

const BACKEND_BUILTIN_ALIASES = new Set(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'])

/** Convert the registry identity to the exact ID accepted by state plans. */
export function backendBodyId(body: Pick<CelestialBody, 'id' | 'naifId'>): string {
  const target = bodyNaifId(body)
  // Only the Go catalog's stable builtin aliases stay named. Every other
  // mapped NAIF body uses its explicit backend identity.
  if (target !== undefined && (!BACKEND_BUILTIN_ALIASES.has(body.id) || body.id.startsWith('naif:'))) return `naif:${target}`
  return body.id
}
