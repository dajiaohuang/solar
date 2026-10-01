import { ScreenPointIndex } from './screenPointIndex'

/** Build on demand in bounded batches; repeated clicks reuse completed indices.
 * A changed camera, epoch, draw range, or newer click cancels pending picks. */
export class CooperativeScreenPicker {
  private generation = 0
  private cache: { source: object; key: unknown; index: ScreenPointIndex } | null = null
  supersede() { this.generation++ }
  cancel() { this.supersede(); this.cache = null }
  async nearest(source: object, key: unknown, width: number, height: number, count: number,
    read: (row: number) => { x: number; y: number } | null, valid: () => boolean, x: number, y: number,
    yieldBatch: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0))) {
    const generation = ++this.generation
    const current = () => generation === this.generation && valid()
    if (!current()) return -1
    let index = this.cache?.source === source && this.cache.key === key ? this.cache.index : null
    if (!index) {
      this.cache = null
      index = new ScreenPointIndex(width, height, count)
      for (let start = 0; start < count; start += 2048) {
        if (!current()) return -1
        for (let row = start; row < Math.min(start + 2048, count); row++) {
          const point = read(row)
          if (point) index.add(row, point.x, point.y)
        }
        if (start + 2048 < count) await yieldBatch()
      }
      if (!current()) return -1
      this.cache = { source, key, index }
    }
    return current() ? index.nearest(x, y, 7) : -1
  }
}
