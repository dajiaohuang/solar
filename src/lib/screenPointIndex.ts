/** Pixel-distance picking for a fixed camera/geometry revision. Packed
 * linked cells avoid allocating one object per displayed point. Offscreen and
 * clipped points never enter the index; dense overlapping cells retain every
 * candidate and preserve deterministic source-order tie breaking. */
export class ScreenPointIndex {
  private heads: Int32Array
  private next: Int32Array
  // Screen coordinates are visual-only; Float32 retains far finer precision
  // than the pixel-radius picker needs while halving the large scene cache.
  private xy: Float32Array | undefined
  private pointReader: ((index: number, output: Float64Array) => void) | undefined
  private pointScratch: Float64Array | undefined
  private columns: number
  private rows: number
  readonly width: number
  readonly height: number
  readonly cellSize: number
  readonly count: number
  constructor(width: number, height: number, count: number, cellSize = 18, pointReader?: (index: number, output: Float64Array) => void) {
    this.width = width; this.height = height; this.cellSize = cellSize; this.count = count
    this.columns = Math.ceil(width / cellSize) + 2; this.rows = Math.ceil(height / cellSize) + 2
    this.heads = new Int32Array(this.columns * this.rows).fill(-1)
    this.next = new Int32Array(count)
    this.pointReader = pointReader
    this.pointScratch = pointReader ? new Float64Array(2) : undefined
    this.xy = pointReader ? undefined : new Float32Array(count * 2)
  }
  /** Drop old cell membership before reusing this index for a new frame. */
  clear() {
    this.heads.fill(-1)
  }
  add(index: number, x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -this.cellSize || x >= this.width + this.cellSize || y < -this.cellSize || y >= this.height + this.cellSize) return
    const column = Math.floor(x / this.cellSize) + 1, row = Math.floor(y / this.cellSize) + 1
    const cell = row * this.columns + column
    if (this.xy) { this.xy[index * 2] = x; this.xy[index * 2 + 1] = y }
    this.next[index] = this.heads[cell]; this.heads[cell] = index
  }
  nearest(x: number, y: number, radius = 9): number {
    let result = -1, distance = radius * radius
    const left = Math.max(0, Math.floor((x - radius) / this.cellSize) + 1), right = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize) + 1)
    const top = Math.max(0, Math.floor((y - radius) / this.cellSize) + 1), bottom = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize) + 1)
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      for (let index = this.heads[row * this.columns + col]; index >= 0; index = this.next[index]) {
        let pointX: number, pointY: number
        if (this.xy) {
          pointX = this.xy[index * 2]; pointY = this.xy[index * 2 + 1]
        } else {
          const reader = this.pointReader, scratch = this.pointScratch
          if (!reader || !scratch) throw new Error('Screen point coordinates are unavailable')
          reader(index, scratch)
          pointX = scratch[0]; pointY = scratch[1]
        }
        const squared = (pointX - x) ** 2 + (pointY - y) ** 2
        if (squared < distance || squared === distance && result >= 0 && index < result) { distance = squared; result = index }
      }
    }
    return result
  }
}
