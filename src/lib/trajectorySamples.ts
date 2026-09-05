import type { BodyPosition, CelestialBody, PackedTrajectoryData, TrajectorySample } from '../types'

/** Bounded detail trails only. Resolver objects live for one epoch; retained
 * samples are written directly into a single Float64 xyz buffer. */
export function createTrajectoryAccumulator(bodies: CelestialBody[], sampleCount: number) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || sampleCount > 600 || bodies.length > 320) {
    throw new RangeError('Trajectory detail budget exceeded')
  }
  const ids = new Map(bodies.map((body, index) => [body.id, index]))
  if (ids.size !== bodies.length) throw new Error('Duplicate trajectory body identity')
  let coordinates = new Float64Array(bodies.length * sampleCount * 3)
  const incomplete = new Uint8Array(bodies.length)
  const seen = new Uint8Array(bodies.length)
  let epochIndex = 0
  let result: PackedTrajectoryData | undefined
  return {
    append(positions: BodyPosition[]) {
      if (result || epochIndex >= sampleCount) throw new RangeError('Trajectory sample count exceeded')
      seen.fill(0)
      for (const { body, position } of positions) {
        const ordinal = ids.get(body.id)
        if (ordinal === undefined) throw new Error('Unknown trajectory body identity')
        if (seen[ordinal]) throw new Error('Duplicate trajectory sample identity')
        seen[ordinal] = 1
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
          incomplete[ordinal] = 1
          continue
        }
        const offset = (ordinal * sampleCount + epochIndex) * 3
        coordinates[offset] = position.x
        coordinates[offset + 1] = position.y
        coordinates[offset + 2] = position.z
      }
      for (let ordinal = 0; ordinal < bodies.length; ordinal++) {
        if (!seen[ordinal]) incomplete[ordinal] = 1
      }
      epochIndex++
    },
    finish(): PackedTrajectoryData {
      if (result) return result
      if (epochIndex !== sampleCount) throw new Error('Incomplete trajectory sampling job')
      const bodyIds: string[] = [], trajectoryUnavailableBodyIds: string[] = []
      for (let ordinal = 0; ordinal < bodies.length; ordinal++) {
        if (incomplete[ordinal] || sampleCount === 0) {
          trajectoryUnavailableBodyIds.push(bodies[ordinal].id)
          continue
        }
        const start = ordinal * sampleCount * 3
        coordinates.copyWithin(bodyIds.length * sampleCount * 3, start, start + sampleCount * 3)
        bodyIds.push(bodies[ordinal].id)
      }
      // Compact gaps once; do not transfer or retain unused rows. The common
      // complete case transfers the original allocation without a copy.
      const length = bodyIds.length * sampleCount * 3
      if (length !== coordinates.length) coordinates = coordinates.slice(0, length)
      const offsets = Uint32Array.from({ length: bodyIds.length + 1 }, (_, index) => index * sampleCount)
      result = { bodyIds, trajectoryUnavailableBodyIds, offsets, coordinates }
      return result
    },
  }
}

/** Reattach bounded body metadata, never unpack point objects or copy samples. */
export function trajectoryViews(packed: PackedTrajectoryData, bodiesById: Map<string, CelestialBody>): TrajectorySample[] {
  if (packed.offsets.length !== packed.bodyIds.length + 1 || packed.offsets[0] !== 0 ||
      packed.coordinates.length % 3 !== 0 || packed.offsets[packed.bodyIds.length] * 3 !== packed.coordinates.length ||
      new Set(packed.bodyIds).size !== packed.bodyIds.length) throw new Error('Invalid packed trajectory layout')
  return packed.bodyIds.map((id, index) => {
    const body = bodiesById.get(id), start = packed.offsets[index], end = packed.offsets[index + 1]
    if (!body || end <= start) throw new Error('Invalid packed trajectory identity or range')
    return { body, coordinates: packed.coordinates.subarray(start * 3, end * 3) }
  })
}
