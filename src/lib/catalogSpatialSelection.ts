import { catalogProjection, type CatalogRotation } from './catalogProjection'

export type CatalogSpatialView = { radius: number; aspect: number; maximumPoints: number; rotation?: CatalogRotation }

function hash(index: number) {
  let value = index + 1
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad)
  value = Math.imul(value ^ value >>> 15, 0x735a2d97)
  return (value ^ value >>> 15) >>> 0
}

/** Visual selection only: deterministic representatives per projected cell.
 * This neither changes orbital states nor estimates density/probability. */
export async function selectCatalogSpatialPoints(
  positions: Float32Array,
  count: number,
  view: CatalogSpatialView,
  cancelled: () => boolean,
  yieldToMessages: () => Promise<void>,
) {
  const stride = view.rotation ? 3 : 2
  const projection = view.rotation ? catalogProjection(view.rotation) : null
  if (!Number.isSafeInteger(count) || count < 0 || count * stride > positions.length ||
      !Number.isFinite(view.radius) || view.radius <= 0 || !Number.isFinite(view.aspect) || view.aspect <= 0 ||
      !Number.isSafeInteger(view.maximumPoints) || view.maximumPoints < 1 || view.maximumPoints > 500_000) throw new Error('Invalid spatial catalog view')
  const columns = Math.max(1, Math.min(view.maximumPoints, Math.floor(Math.sqrt(view.maximumPoints * view.aspect))))
  const rows = Math.max(1, Math.floor(view.maximumPoints / columns))
  const winners = new Uint32Array(columns * rows).fill(0xffffffff)
  let occupied = 0, visible = 0
  for (let start = 0; start < count; start += 20_000) {
    if (cancelled()) return null
    const end = Math.min(count, start + 20_000)
    for (let index = start; index < end; index++) {
      const offset = index*stride
      const px = projection ? projection[0][0]*positions[offset]+projection[0][1]*positions[offset+1] : positions[offset]
      const py = projection ? projection[1][0]*positions[offset]+projection[1][1]*positions[offset+1]+projection[1][2]*positions[offset+2] : positions[offset+1]
      const x = px / view.radius / view.aspect, y = py / view.radius
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid spatial catalog position')
      if (x < -1 || x > 1 || y < -1 || y > 1) continue
      visible++
      const column = Math.min(columns - 1, Math.floor((x + 1) * .5 * columns))
      const row = Math.min(rows - 1, Math.floor((y + 1) * .5 * rows)), cell = row * columns + column
      const previous = winners[cell]
      if (previous === 0xffffffff) { winners[cell] = index; occupied++ }
      else if (hash(index) < hash(previous)) winners[cell] = index
    }
    if (end < count) await yieldToMessages()
  }
  if (cancelled()) return null
  const indices = new Uint32Array(occupied)
  let offset = 0
  for (const winner of winners) if (winner !== 0xffffffff) indices[offset++] = winner
  // Keep source-order blending and make uniqueness/range validation cheap.
  indices.sort()
  return { indices, visible, cells: winners.length }
}
