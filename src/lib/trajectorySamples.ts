import type { BodyPosition, CelestialBody, PackedTrajectoryData, TrajectorySample } from '../types'
import type { CurrentPositions } from './currentPositions'

/** Bounded detail trails only. Resolver objects live for one epoch; retained
 * samples are written directly into a single Float64 xyz buffer. */
export function createTrajectoryAccumulator(bodies: CelestialBody[], sampleCount: number) {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || sampleCount > 600 || bodies.length > 320) {
    throw new RangeError('Trajectory detail budget exceeded')
  }
  const sourceIds = bodies.map(body => body.id)
  const ids = new Map(sourceIds.map((id, index) => [id, index]))
  if (ids.size !== sourceIds.length) throw new Error('Duplicate trajectory body identity')
  let coordinates = new Float64Array(sourceIds.length * sampleCount * 3)
  let breakBefore: Uint8Array | undefined
  const incomplete = new Uint8Array(sourceIds.length)
  const seen = new Uint8Array(sourceIds.length)
  let epochIndex = 0
  let result: PackedTrajectoryData | undefined
  const beginEpoch = () => {
    if (result || epochIndex >= sampleCount) throw new RangeError('Trajectory sample count exceeded')
    seen.fill(0)
  }
  const writePosition = (id: string, x: number, y: number, z: number) => {
    const ordinal = ids.get(id)
    if (ordinal === undefined) throw new Error('Unknown trajectory body identity')
    if (seen[ordinal]) throw new Error('Duplicate trajectory sample identity')
    seen[ordinal] = 1
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { incomplete[ordinal] = 1; return }
    const offset = (ordinal * sampleCount + epochIndex) * 3
    coordinates[offset] = x; coordinates[offset + 1] = y; coordinates[offset + 2] = z
  }
  const endEpoch = () => {
    for (let ordinal = 0; ordinal < sourceIds.length; ordinal++) if (!seen[ordinal]) incomplete[ordinal] = 1
    epochIndex++
  }
  return {
    breakBeforeNextSample(id: string) {
      const ordinal = ids.get(id)
      if (ordinal === undefined || result || epochIndex >= sampleCount) throw new Error('Invalid trajectory break identity or epoch')
      if (epochIndex === 0) return
      breakBefore ??= new Uint8Array(sourceIds.length * sampleCount)
      breakBefore[ordinal * sampleCount + epochIndex] = 1
    },
    append(positions: BodyPosition[]) {
      beginEpoch()
      for (const { body, position } of positions) {
        writePosition(body.id, position.x, position.y, position.z)
      }
      endEpoch()
    },
    appendCurrent(positions: CurrentPositions) {
      beginEpoch()
      for (let index = 0; index < positions.length; index++) {
        writePosition(positions.bodyAt(index).id, positions.coordinateAt(index, 0), positions.coordinateAt(index, 1), positions.coordinateAt(index, 2))
      }
      endEpoch()
    },
    finish(): PackedTrajectoryData {
      if (result) return result
      if (epochIndex !== sampleCount) throw new Error('Incomplete trajectory sampling job')
      const bodyIds: string[] = [], trajectoryUnavailableBodyIds: string[] = []
      for (let ordinal = 0; ordinal < sourceIds.length; ordinal++) {
        if (incomplete[ordinal] || sampleCount === 0) {
          trajectoryUnavailableBodyIds.push(sourceIds[ordinal])
          continue
        }
        const start = ordinal * sampleCount * 3
        if (bodyIds.length !== ordinal) {
          coordinates.copyWithin(bodyIds.length * sampleCount * 3, start, start + sampleCount * 3)
          breakBefore?.copyWithin(bodyIds.length * sampleCount, ordinal * sampleCount, (ordinal + 1) * sampleCount)
        }
        bodyIds.push(sourceIds[ordinal])
      }
      // Compact gaps once; do not transfer or retain unused rows. The common
      // complete case transfers the original allocation without a copy.
      const length = bodyIds.length * sampleCount * 3
      if (length !== coordinates.length) coordinates = coordinates.slice(0, length)
      if (breakBefore && breakBefore.length !== bodyIds.length * sampleCount) breakBefore = breakBefore.slice(0, bodyIds.length * sampleCount)
      const offsets = Uint32Array.from({ length: bodyIds.length + 1 }, (_, index) => index * sampleCount)
      result = { bodyIds, trajectoryUnavailableBodyIds, offsets, coordinates, ...(breakBefore ? { breakBefore } : {}) }
      return result
    },
  }
}

/** Reattach bounded body metadata, never unpack point objects or copy samples. */
export function trajectoryViews(packed: PackedTrajectoryData, bodiesById: Map<string, CelestialBody>): TrajectorySample[] {
  if (!(packed.offsets instanceof Uint32Array) || !(packed.coordinates instanceof Float64Array) ||
      !Array.isArray(packed.bodyIds) || packed.bodyIds.length > 320 ||
      packed.coordinates.length > 320 * 600 * 3 ||
      packed.offsets.length !== packed.bodyIds.length + 1 || packed.offsets[0] !== 0 ||
      packed.coordinates.length % 3 !== 0 || packed.offsets[packed.bodyIds.length] * 3 !== packed.coordinates.length ||
      (packed.breakBefore !== undefined && (!(packed.breakBefore instanceof Uint8Array) || packed.breakBefore.length * 3 !== packed.coordinates.length)) ||
      new Set(packed.bodyIds).size !== packed.bodyIds.length) throw new Error('Invalid packed trajectory layout')
  const unavailable = packed.trajectoryUnavailableBodyIds
  const availableIds = new Set(packed.bodyIds)
  if (!Array.isArray(unavailable) || unavailable.length + packed.bodyIds.length > 320 ||
      new Set(unavailable).size !== unavailable.length ||
      unavailable.some(id => !bodiesById.has(id) || availableIds.has(id))) throw new Error('Invalid unavailable trajectory identities')
  if (packed.breakBefore?.some(flag => flag !== 0 && flag !== 1)) throw new Error('Invalid trajectory discontinuity flag')
  return packed.bodyIds.map((id, index) => {
    const body = bodiesById.get(id), start = packed.offsets[index], end = packed.offsets[index + 1]
    if (!body || end <= start || end-start > 600 || end * 3 > packed.coordinates.length) throw new Error('Invalid packed trajectory identity or range')
    if (packed.breakBefore?.[start]) throw new Error('Trajectory cannot break before its first sample')
    return { body, coordinates: packed.coordinates.subarray(start * 3, end * 3), breakBefore: packed.breakBefore?.subarray(start, end) }
  })
}
