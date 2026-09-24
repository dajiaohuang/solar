import { CATALOG_CLIP_RELATIVE_MARGIN, catalogProjection, type CatalogRotation } from './catalogProjection'
import type { createCatalogSpatialIndex } from './catalogSpatialIndex'

export type CatalogSpatialView = { radius: number; aspect: number; maximumPoints: number; rotation?: CatalogRotation; focusedRow?: number; selectedRows?: readonly number[] }

// Cooperative scheduling policy, not a measured latency guarantee. Check the
// clock only at bounded row/cell/word intervals, never once per source point.
export const CATALOG_SELECTION_SLICE_MS = 4

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
  spatialIndex?: ReturnType<typeof createCatalogSpatialIndex>,
) {
  let sliceStarted = performance.now()
  const yieldSelection = async () => {
    await yieldToMessages()
    sliceStarted = performance.now()
    return cancelled()
  }
  // Camera messages may arrive while this cooperative pass is yielding. Keep
  // one view's projection, normalization and cell layout together throughout.
  const { radius, aspect, maximumPoints, focusedRow } = view
  const stride = view.rotation ? 3 : 2
  const projection = view.rotation ? catalogProjection(view.rotation) : null
  if (!Number.isSafeInteger(count) || count < 0 || count * stride > positions.length ||
      !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(aspect) || aspect <= 0 ||
      !Number.isSafeInteger(maximumPoints) || maximumPoints < 1 || maximumPoints > 1_000_000) throw new Error('Invalid spatial catalog view')
  if (focusedRow !== undefined && (!Number.isSafeInteger(focusedRow) || focusedRow < 0 || focusedRow >= count)) throw new Error('Focused catalog row is outside the uploaded snapshot')
  const requested = view.selectedRows?.slice() ?? []
  if (requested.length > 256 || requested.some(row => !Number.isSafeInteger(row) || row < 0 || row >= count)) throw new Error('Selected catalog rows exceed the bounded snapshot contract')
  const pinned = new Set<number>()
  // Evaluate the same display projection for selected and ordinary rows.
  // Include term magnitudes so cancellation in a rotated coordinate cannot
  // hide Float32 rounding near an edge. Cell clamping below only assigns an
  // admitted edge point to a representative cell; it never moves GPU points.
  let screenX = 0, screenY = 0
  const screen = (index: number) => {
    const offset = index*stride
    const ax = projection ? projection[0][0]*positions[offset] : positions[offset]
    const bx = projection ? projection[0][1]*positions[offset+1] : 0
    const ay = projection ? projection[1][0]*positions[offset] : 0
    const by = projection ? projection[1][1]*positions[offset+1] : positions[offset+1]
    const cy = projection ? projection[1][2]*positions[offset+2] : 0
    const x = (ax+bx)/radius/aspect, y = (ay+by+cy)/radius
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid spatial catalog position')
    const marginX = CATALOG_CLIP_RELATIVE_MARGIN*(1+(Math.abs(ax)+Math.abs(bx))/radius/aspect)
    const marginY = CATALOG_CLIP_RELATIVE_MARGIN*(1+(Math.abs(ay)+Math.abs(by)+Math.abs(cy))/radius)
    screenX = x; screenY = y
    return x >= -1-marginX && x <= 1+marginX && y >= -1-marginY && y <= 1+marginY
  }
  for (const index of focusedRow === undefined ? requested : [focusedRow, ...requested]) {
    if (pinned.size >= maximumPoints) break
    if (screen(index)) pinned.add(index)
  }
  if (spatialIndex && (spatialIndex.positions !== positions || spatialIndex.dimensions !== stride)) throw new Error('Spatial index belongs to another catalog snapshot')
  // Display limits can exceed this snapshot's admitted capacity. No more than
  // count rows can win, so grid scratch must not scale with an unrelated UI
  // ceiling (e.g. 500k representatives for a handful of loaded source rows).
  // Keep the planner's per-admitted-row allocation bound, including empty views.
  const cellBudget = Math.min(maximumPoints, count)-pinned.size
  // When every uploaded row fits, screen-cell collisions must not discard
  // otherwise visible bodies. Use one bounded slot per source row in this
  // case; only snapshots exceeding the display budget need representatives.
  const retainAll = count <= maximumPoints
  const columns = Math.max(1, Math.min(cellBudget, Math.floor(Math.sqrt(cellBudget * aspect))))
  const rows = Math.max(1, Math.floor(cellBudget / columns))
  const winners = new Uint32Array(retainAll ? count : cellBudget ? columns * rows : 0).fill(0xffffffff)
  const winnerInside = new Uint8Array(winners.length)
  let occupied = 0, visible = 0, edgeCandidates = 0, skippedRows = 0, testedRows = 0
  const sliceRows = spatialIndex ? spatialIndex.blockRows * 16 : 16_384
  for (let start = 0; start < count; start += sliceRows) {
    if (cancelled()) return null
    const end = Math.min(count, start + sliceRows)
    for (let index = start; index < end; index++) {
      // A spatial-bound rebuild itself is bounded to one 1024-row block.
      // When that or projection/selection work is slow, service newer camera
      // messages before finishing the older fixed 16k-row batch.
      if (index % 1024 === 0 && performance.now()-sliceStarted >= CATALOG_SELECTION_SLICE_MS) {
        if (await yieldSelection()) return null
      }
      if (spatialIndex && index % spatialIndex.blockRows === 0) {
        const blockEnd = Math.min(count, index+spatialIndex.blockRows)
        if (blockEnd <= end && !spatialIndex.intersects(index, blockEnd, projection, radius, aspect)) {
          skippedRows += blockEnd-index; index = blockEnd-1; continue
        }
      }
      testedRows++
      if (!screen(index)) continue
      const x = screenX, y = screenY
      const inside = x >= -1 && x <= 1 && y >= -1 && y <= 1
      visible++
      if (!inside) edgeCandidates++
      if (pinned.has(index) || !cellBudget) continue
      const column = Math.max(0, Math.min(columns - 1, Math.floor((x + 1) * .5 * columns)))
      const row = Math.max(0, Math.min(rows - 1, Math.floor((y + 1) * .5 * rows))), cell = retainAll ? index : row * columns + column
      const previous = winners[cell]
      // An allowance-only point may be clipped by the GPU. It must not evict
      // a mathematical-viewport point from an otherwise populated cell.
      // Explicit focus/selection pins keep their independent priority.
      if (previous === 0xffffffff) {
        winners[cell] = index; winnerInside[cell] = Number(inside); occupied++
      } else if (Number(inside) > winnerInside[cell] ||
          Number(inside) === winnerInside[cell] && hash(index) < hash(previous)) {
        winners[cell] = index; winnerInside[cell] = Number(inside)
      }
    }
    if (end < count && await yieldSelection()) return null
  }
  if (cancelled()) return null
  // Bit membership preserves exactly the same source-order output without a
  // potentially 500k-element synchronous sort. This scratch is budgeted by the
  // stream planner and both collection stages cooperate with cancellation.
  const selected = new Uint32Array(Math.ceil(count / 32))
  for (const index of pinned) selected[index >>> 5] |= 1 << (index&31)
  for (let start = 0; start < winners.length; start += 16_384) {
    if (cancelled()) return null
    const end = Math.min(winners.length, start + 16_384)
    for (let cell = start; cell < end; cell++) {
      if (cell % 1024 === 0 && performance.now()-sliceStarted >= CATALOG_SELECTION_SLICE_MS) {
        if (await yieldSelection()) return null
      }
      const winner = winners[cell]
      if (winner !== 0xffffffff) selected[winner >>> 5] |= 1 << (winner & 31)
    }
    if (end < winners.length && await yieldSelection()) return null
  }
  const indices = new Uint32Array(occupied+pinned.size)
  let offset = 0
  for (let start = 0; start < selected.length; start += 512) {
    if (cancelled()) return null
    const end = Math.min(selected.length, start + 512)
    for (let index = start; index < end; index++) {
      // One word enumerates at most 32 source rows. This also bounds the
      // source-order assembly stage when most representative cells are full.
      if (index % 32 === 0 && performance.now()-sliceStarted >= CATALOG_SELECTION_SLICE_MS) {
        if (await yieldSelection()) return null
      }
      let word = selected[index]
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word)
        indices[offset++] = index * 32 + bit
        word = (word & (word - 1)) >>> 0
      }
    }
    if (end < selected.length && await yieldSelection()) return null
  }
  if (cancelled()) return null
  if (offset !== occupied+pinned.size) throw new Error('Spatial catalog membership count mismatch')
  return { indices, visible, edgeCandidates, cells: winners.length, testedRows, skippedRows }
}
