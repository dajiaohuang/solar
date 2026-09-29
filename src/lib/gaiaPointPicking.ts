import capacity from '../data/gaiaCapacity.json'
import { ScreenPointIndex } from './screenPointIndex'

/** Build a pixel-distance index for the immutable Gaia display snapshot. */
export function buildGaiaScreenPointIndex(batches: readonly Float32Array[], width: number, height: number, zoom: number, count: number) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 ||
      !Number.isFinite(zoom) || zoom <= 0 || !Number.isSafeInteger(count) || count < 0 || count > capacity.maxChartRows) {
    throw new RangeError('Invalid Gaia picking snapshot')
  }
  const batchStarts: number[] = []
  const readPoint = (ordinal: number, output: Float64Array) => {
    // Reproduce the rounded screen position from the immutable Float32 display
    // batch instead of retaining a second Float64 coordinate pair per point.
    let low = 0, high = batchStarts.length
    while (low < high) {
      const middle = low + ((high - low) >>> 1)
      if (batchStarts[middle] <= ordinal) low = middle + 1
      else high = middle
    }
    const batchIndex = low - 1, batch = batches[batchIndex]
    if (!batch) throw new RangeError('Gaia picking ordinal is outside its display batches')
    const offset = (ordinal-batchStarts[batchIndex])*3
    const x = Math.fround(batch[offset] * zoom), y = Math.fround(batch[offset+1] * zoom)
    output[0] = (x + 1) * width / 2
    output[1] = (1 - y) * height / 2
  }
  const index = new ScreenPointIndex(width, height, count, 18, readPoint)
  let ordinal = 0
  for (const batch of batches) {
    if (!(batch instanceof Float32Array) || batch.length % 3 !== 0) throw new RangeError('Invalid Gaia picking batch')
    batchStarts.push(ordinal)
    for (let offset = 0; offset < batch.length; offset += 3, ordinal++) {
      if (ordinal >= count) throw new RangeError('Gaia picking batches exceed their uploaded row count')
      const x = Math.fround(batch[offset] * zoom), y = Math.fround(batch[offset + 1] * zoom)
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Nonfinite Gaia picking position')
      if (Math.abs(x) > 1 || Math.abs(y) > 1) continue
      index.add(ordinal, (x + 1) * width / 2, (1 - y) * height / 2)
    }
  }
  if (ordinal !== count) throw new RangeError('Gaia picking batches differ from their uploaded row count')
  return index
}
