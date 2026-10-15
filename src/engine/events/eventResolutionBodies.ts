import type { CelestialBody } from '../../types'

/** Preserve the body lookups used by the frozen event resolver, including
 * implicit Earth/Moon barycenter partitioning. SPK center dependencies remain
 * in the separately declared kernel pool, not this body-description list. */
export function eventResolutionBodies(params: {
  bodies: readonly CelestialBody[]
  resolutionBodies: readonly CelestialBody[]
  referenceId: string
  eventKinds: readonly string[]
}): CelestialBody[] {
  const byId = new Map(params.resolutionBodies.map(body => [body.id, body]))
  const wanted = new Set(params.bodies.map(body => body.id))
  wanted.add('sun')
  if (params.eventKinds.some(kind => kind === 'conjunction' || kind === 'opposition')) wanted.add(params.referenceId)
  if (params.eventKinds.some(kind => ['perihelion', 'aphelion', 'periapsis', 'apoapsis'].includes(kind))) {
    for (const body of params.bodies) wanted.add(body.parentId ?? 'sun')
  }
  const result: CelestialBody[] = []
  // Set iteration visits appended dependencies once, including cyclic parent
  // references. Missing descriptions stay missing; never invent a fallback.
  for (const id of wanted) {
    if ((id === 'earth' || id === 'moon') && byId.get('earth')?.orbitRepresents === 'earth-moon-barycenter') {
      wanted.add('earth')
      wanted.add('moon')
    }
    const body = byId.get(id)
    if (!body) continue
    result.push(body)
    if (body.parentId) wanted.add(body.parentId)
  }
  return result
}
