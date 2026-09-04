import type { BodyId, CelestialBody } from '../types'

/** These budgets bound expensive trails/meshes, never current-state coverage. */
export function selectDetailBodies(bodies: CelestialBody[], limit: number, priorityIds: BodyId[] = []) {
  const wanted = new Set(priorityIds)
  const result = bodies.filter(body => wanted.has(body.id)).slice(0, limit)
  const selected = new Set(result.map(body => body.id))
  for (const body of bodies) {
    if (result.length >= limit) break
    if (!selected.has(body.id)) { result.push(body); selected.add(body.id) }
  }
  return result
}
