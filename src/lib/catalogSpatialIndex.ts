import { CATALOG_CLIP_RELATIVE_MARGIN } from './catalogProjection'

export const CATALOG_SPATIAL_BLOCK_ROWS = 1024
type Projection = readonly [readonly [number, number, number], readonly [number, number, number]]

/** Visual acceleration over the exact same Float32 positions used by culling.
 * Bounds never select representatives or change scientific source rows. */
export function createCatalogSpatialIndex(positions: Float32Array, dimensions: 2 | 3) {
  if ((dimensions !== 2 && dimensions !== 3) || positions.length % dimensions) throw new RangeError('Invalid catalog spatial-index dimensions')
  const capacity = positions.length/dimensions, blockRows = CATALOG_SPATIAL_BLOCK_ROWS
  const blocks = Math.ceil(capacity/blockRows)
  const bounds = new Float64Array(blocks*dimensions*2), ends = new Uint32Array(blocks), dirty = new Uint8Array(blocks).fill(1)
  return {
    positions, dimensions, blockRows,
    bytes: bounds.byteLength+ends.byteLength+dirty.byteLength,
    invalidate(startRow: number, count: number) {
      if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(count) || startRow < 0 || count < 0 || startRow+count > capacity) throw new RangeError('Invalid catalog spatial invalidation range')
      if (count) dirty.fill(1, Math.floor(startRow/blockRows), Math.ceil((startRow+count)/blockRows))
    },
    intersects(startRow: number, endRow: number, projection: Projection | null, radius: number, aspect: number) {
      if (!Number.isSafeInteger(startRow) || startRow < 0 || startRow % blockRows || !Number.isSafeInteger(endRow) || endRow <= startRow ||
          endRow > Math.min(capacity, startRow+blockRows) || Boolean(projection) !== (dimensions === 3)) throw new RangeError('Invalid catalog spatial bound query')
      const block = startRow/blockRows, offset = block*dimensions*2
      if (dirty[block] || ends[block] !== endRow) {
        for (let axis = 0; axis < dimensions; axis++) { bounds[offset+axis*2] = Infinity; bounds[offset+axis*2+1] = -Infinity }
        for (let row = startRow; row < endRow; row++) {
          for (let axis = 0; axis < dimensions; axis++) {
            const value = positions[row*dimensions+axis]
            if (!Number.isFinite(value)) throw new RangeError('Nonfinite indexed catalog position')
            bounds[offset+axis*2] = Math.min(bounds[offset+axis*2], value)
            bounds[offset+axis*2+1] = Math.max(bounds[offset+axis*2+1], value)
          }
        }
        ends[block] = endRow; dirty[block] = 0
      }
      const width = radius*aspect
      // Exceptional normalization stays on the original exact point path.
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(radius) || radius <= 0) return true
      for (let screenAxis = 0; screenAxis < 2; screenAxis++) {
        let low = 0, high = 0, magnitude = 0
        for (let axis = 0; axis < dimensions; axis++) {
          const coefficient = projection ? projection[screenAxis][axis] : Number(screenAxis === axis)
          const a = coefficient*bounds[offset+axis*2], b = coefficient*bounds[offset+axis*2+1]
          low += Math.min(a, b); high += Math.max(a, b); magnitude += Math.max(Math.abs(a), Math.abs(b))
        }
        const extent = screenAxis === 0 ? width : radius
        // Match the point-screen margin, with extra headroom for the bound
        // projection itself. Double-precision padding alone can reject points
        // whose Float32 shader coordinates round onto the visible edge.
        const padding = 2*CATALOG_CLIP_RELATIVE_MARGIN*(magnitude+extent)+Number.MIN_VALUE
        if (high+padding < -extent || low-padding > extent) return false
      }
      return true
    },
  }
}
