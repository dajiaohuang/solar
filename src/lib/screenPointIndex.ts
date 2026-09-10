/** Exact pixel-distance picking for a fixed camera/geometry revision. Packed
 * linked cells avoid allocating one object per displayed point. Offscreen and
 * clipped points never enter the index; dense overlapping cells retain every
 * candidate and preserve deterministic source-order tie breaking. */
export class ScreenPointIndex {
  private heads: Int32Array
  private next: Int32Array
  private xy: Float64Array
  private columns: number
  private rows: number
  readonly width: number
  readonly height: number
  readonly cellSize: number
  constructor(width: number, height: number, count: number, cellSize = 18) {
    this.width = width; this.height = height; this.cellSize = cellSize
    this.columns = Math.ceil(width / cellSize) + 2; this.rows = Math.ceil(height / cellSize) + 2
    this.heads = new Int32Array(this.columns * this.rows).fill(-1)
    this.next = new Int32Array(count).fill(-1); this.xy = new Float64Array(count * 2)
  }
  add(index: number, x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -this.cellSize || x >= this.width + this.cellSize || y < -this.cellSize || y >= this.height + this.cellSize) return
    const column = Math.floor(x / this.cellSize) + 1, row = Math.floor(y / this.cellSize) + 1
    const cell = row * this.columns + column
    this.xy[index * 2] = x; this.xy[index * 2 + 1] = y
    this.next[index] = this.heads[cell]; this.heads[cell] = index
  }
  nearest(x: number, y: number, radius = 9): number {
    let result = -1, distance = radius * radius
    const left = Math.max(0, Math.floor((x - radius) / this.cellSize) + 1), right = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize) + 1)
    const top = Math.max(0, Math.floor((y - radius) / this.cellSize) + 1), bottom = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize) + 1)
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      for (let index = this.heads[row * this.columns + col]; index >= 0; index = this.next[index]) {
        const squared = (this.xy[index * 2] - x) ** 2 + (this.xy[index * 2 + 1] - y) ** 2
        if (squared < distance || squared === distance && result >= 0 && index < result) { distance = squared; result = index }
      }
    }
    return result
  }
}
