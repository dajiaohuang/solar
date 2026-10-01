import { planCatalogStream } from './catalogStreaming'
import type { CatalogStreamResult } from './catalogStreaming'
import type { AsteroidManifest } from '../types'
import type { CatalogStreamRequest, CatalogStreamResponse } from '../workers/catalog-stream.protocol'

/** Extra headroom for two Float64 snapshots, packed appearance, and both scene
 * renderers' geometrically grown CPU/GPU attributes. Not a browser RSS limit. */
export function planExplorerCatalog(manifest: AsteroidManifest, rows: number, budgetBytes: number, mode: '2d' | '3d') {
  if (!Number.isSafeInteger(rows) || rows < 1 || !Number.isSafeInteger(budgetBytes) || budgetBytes < 1 || budgetBytes > 1024 * 1024 * 1024) throw new Error('Invalid Explorer catalog budget')
  const requested = Math.min(rows, manifest.totalCount)
  // Includes the lazy xy projection and two panes' screen picking indices.
  const extraBytesPerRow = 208
  // Find a capacity whose additional scene storage fits beside the worker plan.
  let low = 0, high = requested
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2)
    const workerBudget = Math.min(512 * 1024 * 1024, budgetBytes - candidate * extraBytesPerRow)
    const capacity = workerBudget > 0 ? planCatalogStream(manifest, candidate, workerBudget, mode, true).capacity : 0
    if (capacity >= candidate) low = candidate
    else high = candidate - 1
  }
  if (!low) throw new Error('Catalog reserves exceed the selected scene memory budget')
  return { capacity: low, workerBudget: Math.min(512 * 1024 * 1024, budgetBytes - low * extraBytesPerRow) }
}

export type ExplorerCatalogSnapshot = {
  positions: Float64Array; appearance: Uint8Array; julianDay: number; count: number
  result: CatalogStreamResult; revision: number
}

/** One in-flight epoch and two buffers. Published arrays remain untouched until
 * the next completed snapshot replaces them; partial epochs never reach React. */
export function createExplorerCatalogSession(capacity: number, mode: '2d' | '3d', initialEpoch: number,
  send: (message: CatalogStreamRequest, transfer?: Transferable[]) => void,
  publish: (snapshot: ExplorerCatalogSnapshot) => void) {
  const dimensions = mode === '3d' ? 3 : 2
  let front = new Float64Array(capacity * dimensions), back = new Float64Array(capacity * dimensions)
  const appearance = new Uint8Array(capacity * 2)
  let count = 0, sourceRows = 0, revision = 0, epoch = initialEpoch, requestedEpoch = initialEpoch
  let result: CatalogStreamResult | null = null, active = true, busy = false, started = false, nextRow = 0, requestId = 0
  const publishSnapshot = () => {
    const previous = front; front = back; back = previous
    epoch = requestedEpoch
    publish({ positions: front.subarray(0, count * dimensions), appearance: appearance.subarray(0, count * 2), julianDay: epoch, count, result: result!, revision: ++revision })
  }
  const copy = (positions: Float64Array, start: number, rows: number) => {
    if (!(positions instanceof Float64Array) || !Number.isSafeInteger(start) || !Number.isSafeInteger(rows) || start < 0 || rows < 0 || start + rows > capacity || positions.length !== rows * dimensions) throw new Error('Invalid Explorer catalog position tile')
    for (const value of positions) if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new Error('Nonfinite Explorer catalog position')
    back.set(positions, start * dimensions)
  }
  return {
    request(julianDay: number) {
      if (!active || busy || !result || julianDay === epoch) return
      if (!Number.isFinite(julianDay)) throw new Error('Invalid Explorer catalog epoch')
      busy = true; started = false; nextRow = 0; requestedEpoch = julianDay
      send({ type: 'epoch', requestId: ++requestId, julianDay, maximumDriftAU: 0 })
    },
    dispose() { active = false; front = new Float64Array(); back = new Float64Array(); result = null },
    handle(message: CatalogStreamResponse) {
      if (!active) return
      if (message.type === 'error' || message.type === 'epoch-error') throw new Error(message.error)
      if (message.type === 'tile') {
        if (result || message.drawnRows !== count + message.positions.length / dimensions || message.sourceRows < sourceRows || message.appearance.length !== message.positions.length / dimensions * 2) throw new Error('Invalid Explorer catalog initial sequence')
        copy(message.positions, count, message.positions.length / dimensions)
        appearance.set(message.appearance, count * 2)
        count = message.drawnRows; sourceRows = message.sourceRows
        send({ type: 'ack', tileId: message.tileId, positions: message.positions }, [message.positions.buffer])
      } else if (message.type === 'done') {
        if (result || !message.retainedEpochs || message.drawnRows !== count || !Number.isSafeInteger(message.sourceRows) || message.sourceRows < sourceRows) throw new Error('Invalid Explorer catalog completion')
        result = message; publishSnapshot()
      } else if (message.type.startsWith('epoch-')) {
        if (!('requestId' in message) || message.requestId !== requestId || !busy || !('julianDay' in message) || message.julianDay !== requestedEpoch) throw new Error('Explorer catalog epoch identity mismatch')
        if (message.type === 'epoch-start') {
          if (started || message.count !== count) throw new Error('Invalid Explorer catalog epoch start')
          started = true
        } else {
          if (!started) throw new Error('Explorer catalog epoch arrived before start')
          if (message.type === 'epoch-tile') {
            if (message.startRow !== nextRow || message.count < 1 || nextRow + message.count > count) throw new Error('Noncontiguous Explorer catalog epoch')
            copy(message.positions, nextRow, message.count); nextRow += message.count
            send({ type: 'epoch-ack', requestId, startRow: message.startRow, positions: message.positions }, [message.positions.buffer])
          } else if (message.type === 'epoch-reuse') {
            if (message.startRow !== nextRow || message.count < 1 || nextRow + message.count > count || message.displacementAU !== 0 || message.computedJulianDay !== requestedEpoch || epoch !== requestedEpoch) throw new Error('Explorer catalog cannot reuse a different epoch')
            back.set(front.subarray(nextRow * dimensions, (nextRow + message.count) * dimensions), nextRow * dimensions)
            nextRow += message.count
            send({ type: 'epoch-reuse-ack', requestId, startRow: message.startRow, count: message.count })
          } else if (message.type === 'epoch-done') {
            if (message.count !== count || nextRow !== count || message.maximumDisplacementAU !== 0 || message.maximumDriftAU !== 0 || message.recomputedRows + message.reusedRows !== count || count > 0 && (message.computedEpochRange?.[0] !== requestedEpoch || message.computedEpochRange?.[1] !== requestedEpoch)) throw new Error('Incomplete Explorer catalog epoch')
            busy = false; publishSnapshot()
          }
        }
      }
    },
  }
}
