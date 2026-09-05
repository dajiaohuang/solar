import type { BodyId, CelestialBody, RenderedBodyPosition } from '../types'

/** Scalar view over scientific storage or a bounded local packed frame.
 * No per-body vectors, planar copy, iterator or array compatibility layer. */
export class CurrentPositions {
  readonly length: number
  private readonly readBody: (index: number) => CelestialBody
  private readonly readCoordinate: (index: number, axis: number) => number
  constructor(length: number,
    readBody: (index: number) => CelestialBody,
    readCoordinate: (index: number, axis: number) => number,
  ) {
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('Invalid position count')
    this.length = length; this.readBody = readBody; this.readCoordinate = readCoordinate
  }
  private check(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) throw new RangeError('Position ordinal is out of range')
  }
  bodyAt(index: number) { this.check(index); return this.readBody(index) }
  coordinateAt(index: number, axis: number) {
    this.check(index)
    if (!Number.isInteger(axis) || axis < 0 || axis > 2) throw new RangeError('Position axis is out of range')
    return this.readCoordinate(index, axis)
  }
  distanceAt(index: number) { return Math.hypot(this.coordinateAt(index, 0), this.coordinateAt(index, 1), this.coordinateAt(index, 2)) }
  indexOf(bodyId: BodyId | null | undefined) {
    if (bodyId == null) return -1
    for (let index = 0; index < this.length; index++) if (this.readBody(index).id === bodyId) return index
    return -1
  }
  /** Only explicit bounded detail/label/hover consumers should call this. */
  rowAt(index: number): RenderedBodyPosition {
    const x = this.coordinateAt(index, 0), y = this.coordinateAt(index, 1), z = this.coordinateAt(index, 2)
    return { body: this.bodyAt(index), planarPosition: { x, y }, position3D: { x, y, z }, distance: Math.hypot(x, y, z) }
  }
  maxDistance() {
    let largest = 0
    for (let index = 0; index < this.length; index++) largest = Math.max(largest, this.distanceAt(index))
    return largest
  }
}

export const EMPTY_CURRENT_POSITIONS = new CurrentPositions(0, () => { throw new RangeError('Empty frame') }, () => { throw new RangeError('Empty frame') })

export function concatCurrentPositions(first: CurrentPositions, second: CurrentPositions) {
  if (!first.length) return second
  if (!second.length) return first
  return new CurrentPositions(first.length + second.length,
    index => index < first.length ? first.bodyAt(index) : second.bodyAt(index - first.length),
    (index, axis) => index < first.length ? first.coordinateAt(index, axis) : second.coordinateAt(index - first.length, axis))
}

/** Source-order ordinal selection, retaining the original scalar storage. */
export function selectCurrentPositions(source: CurrentPositions, ordinals: Uint32Array) {
  const selected = ordinals.slice()
  for (const ordinal of selected) if (ordinal >= source.length) throw new RangeError('Selected position ordinal is out of range')
  return new CurrentPositions(selected.length, index => source.bodyAt(selected[index]), (index, axis) => source.coordinateAt(selected[index], axis))
}

/** Bounded preview producers write one Float64 triple, never separate 2D/3D arrays. */
export function packedCurrentPositions(bodies: readonly CelestialBody[], coordinates: Float64Array) {
  if (coordinates.length !== bodies.length * 3) throw new Error('Position columns do not match body count')
  return new CurrentPositions(bodies.length, index => bodies[index], (index, axis) => coordinates[index * 3 + axis])
}

/** One scalar pass, not a full row array or repeated full-scene ID scans. */
export function currentPositionDetails(source: CurrentPositions, bodyIds: readonly BodyId[], limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid position detail limit')
  const wanted = new Set(bodyIds.slice(0, limit)), rows: RenderedBodyPosition[] = []
  for (let index = 0; index < source.length && rows.length < wanted.size; index++) {
    if (wanted.has(source.bodyAt(index).id)) rows.push(source.rowAt(index))
  }
  return rows
}
