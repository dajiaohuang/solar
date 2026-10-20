import { createCatalogPointWorkspace, PREPARED_CATALOG_STRIDE, propagatePreparedCatalogTile, type CatalogPointMode, type CatalogPointWorkspace, type PreparedCatalogElements } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'
import { catalogTemporalDisplacementAU } from '../engine/ephemeris/catalogTemporalBudget'
import { CATALOG_EPOCH_TILE_ROWS, CATALOG_EPOCH_UPLOAD_SLOTS } from './catalogEpochCapacity'

export type CatalogEpochTile = { startRow: number; count: number; julianDay: number; positions: Float64Array }
export type CatalogEpochReuse = { startRow: number; count: number; julianDay: number; computedJulianDay: number; displacementAU: number }
export type CatalogEpochResult = { count: number; julianDay: number; reusedRows: number; recomputedRows: number; maximumDisplacementAU: number; computedEpochRange: [number, number] | null;
  maximumDriftAU: number; blockEpochs: Float64Array;
  workerTimingMs: { computeAndYield: number; propagation: number; cooperativeYield: number; tileOwnershipWait: number; reuseAckWait: number; tileRows: number; maxUnacknowledgedTiles: number; peakUnacknowledgedTiles: number; total: number } }

/** Owns prepared Float64 source coefficients in original upload order. Capacity
 * must come from planCatalogStream(..., retainEpochs=true). Appends take
 * ownership of each exact-sized coefficient buffer; callers must not mutate or
 * transfer it afterwards. No second capacity-sized coefficient array is kept. */
export function createCatalogEpochStore(capacity: number, mode: CatalogPointMode, maximumBlocks: number) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity*PREPARED_CATALOG_STRIDE*8 > 512*1024*1024 ||
      (mode !== '2d' && mode !== '3d') || !Number.isSafeInteger(maximumBlocks) || maximumBlocks < 1 || maximumBlocks > 131072+256) throw new RangeError('Invalid retained catalog capacity or dimension')
  const preparedBlocks: PreparedCatalogElements[] = new Array(maximumBlocks)
  const dimensions = mode === '3d' ? 3 : 2
  const starts = new Uint32Array(maximumBlocks), counts = new Uint32Array(maximumBlocks), preparedOffsets = new Uint32Array(maximumBlocks)
  const speeds = new Float64Array(maximumBlocks), blockEpochs = new Float64Array(maximumBlocks)
  let blocks = 0
  let count = 0, retainedSourceBytes = 0, sealed = false, computing = false
  const appendSource = (source: PreparedCatalogElements, startRow: number,
    maximumSpeedAUPerTtDay: number | null, uploadedJulianDay: number | null,
    blockMaximumSpeedsAUPerTtDay?: readonly (number | null)[]) => {
    if (computing || sealed !== (uploadedJulianDay !== null) || startRow !== count ||
        !Number.isSafeInteger(source.count) || source.count < 0 ||
        !(source.data instanceof Float64Array) || source.data.length !== source.count*PREPARED_CATALOG_STRIDE ||
        count+source.count > capacity) throw new RangeError('Invalid retained catalog source append')
    if (uploadedJulianDay !== null && (!Number.isFinite(uploadedJulianDay) || uploadedJulianDay < 2441317.5)) {
      throw new RangeError('Invalid appended catalog upload epoch')
    }
    // Complete admission before modifying coefficients or existing block evidence.
    if (!source.data.every(Number.isFinite)) throw new RangeError('Nonfinite retained catalog coefficients')
    if (blockMaximumSpeedsAUPerTtDay !== undefined) {
      if (!Array.isArray(blockMaximumSpeedsAUPerTtDay) ||
          blockMaximumSpeedsAUPerTtDay.length !== Math.ceil(source.count/CATALOG_EPOCH_TILE_ROWS)) {
        throw new RangeError('Retained catalog epoch speed blocks do not match the prepared rows')
      }
      let hasUnknownSpeed = false, blockMaximumSpeed = 0
      for (const speed of blockMaximumSpeedsAUPerTtDay) {
        if (speed === null) hasUnknownSpeed = true
        else if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('Invalid retained catalog epoch block speed')
        else blockMaximumSpeed = Math.max(blockMaximumSpeed,speed)
      }
      const expectedMaximum = source.count && !hasUnknownSpeed ? blockMaximumSpeed : null
      if (maximumSpeedAUPerTtDay !== expectedMaximum) throw new RangeError('Catalog maximum speed differs from its epoch block bounds')
    }
    if (maximumSpeedAUPerTtDay !== null && (!Number.isFinite(maximumSpeedAUPerTtDay) || maximumSpeedAUPerTtDay <= 0)) throw new RangeError('Invalid retained source speed cap')
    const sourceBlockCount = source.count ? blockMaximumSpeedsAUPerTtDay?.length ?? 1 : 0
    if (blocks+sourceBlockCount > maximumBlocks) throw new RangeError('Retained catalog source-block capacity exceeded')
    if (source.count) {
      // Normal stream and append producers hand over exact-sized buffers. Copy
      // only unusual views so an unrelated backing-buffer tail is not retained.
      // All temporal sub-blocks share this one immutable prepared source slab.
      const data = source.data.byteOffset === 0 && source.data.buffer.byteLength === source.data.byteLength
        ? source.data : source.data.slice()
      const prepared = Object.freeze({ count: source.count, data })
      retainedSourceBytes += data.byteLength
      for (let block = 0; block < sourceBlockCount; block++) {
        const sourceOffset = blockMaximumSpeedsAUPerTtDay === undefined ? 0 : block*CATALOG_EPOCH_TILE_ROWS
        const rows = blockMaximumSpeedsAUPerTtDay === undefined ? source.count :
          Math.min(CATALOG_EPOCH_TILE_ROWS,source.count-sourceOffset)
        preparedBlocks[blocks] = prepared
        starts[blocks] = count+sourceOffset; counts[blocks] = rows; preparedOffsets[blocks] = sourceOffset
        speeds[blocks] = (blockMaximumSpeedsAUPerTtDay?.[block] ?? maximumSpeedAUPerTtDay) ?? NaN
        blockEpochs[blocks] = uploadedJulianDay ?? NaN
        blocks++
      }
    }
    count += source.count
  }
  const findBlock = (row: number) => {
    let low = 0, high = blocks
    while (low < high) {
      const middle = (low+high) >>> 1
      if (starts[middle]+counts[middle] <= row) low = middle+1
      else high = middle
    }
    if (low >= blocks || starts[low] > row) throw new RangeError('Retained catalog source blocks do not cover the requested rows')
    return low
  }
  const propagateRange = (rangeStart: number, rangeEnd: number, epochTt: number,
    output: Float64Array, block: number, workspace: CatalogPointWorkspace) => {
    let row = rangeStart
    while (row < rangeEnd) {
      const blockStart = starts[block], blockEnd = blockStart+counts[block], source = preparedBlocks[block]
      if (!source || blockStart > row || blockEnd <= row) throw new RangeError('Retained catalog source blocks contain a gap')
      const end = Math.min(rangeEnd,blockEnd), outputStart = (row-rangeStart)*dimensions
      const sourceStart = preparedOffsets[block]+row-blockStart
      propagatePreparedCatalogTile(source,epochTt,mode,sourceStart,sourceStart+end-row,
        output.subarray(outputStart,(end-rangeStart)*dimensions),workspace)
      row = end
      if (row === blockEnd) block++
    }
    return block
  }
  return {
    capacity,
    get retainedBytes() { return retainedSourceBytes+maximumBlocks*36 },
    get count() { return count },
    get ready() { return sealed },
    append(source: PreparedCatalogElements, startRow: number, maximumSpeedAUPerTtDay: number | null,
      blockMaximumSpeedsAUPerTtDay?: readonly (number | null)[]) {
      appendSource(source, startRow, maximumSpeedAUPerTtDay, null, blockMaximumSpeedsAUPerTtDay)
    },
    /** Append only after the consumer acknowledges these rows at this epoch.
     * Existing mixed/unknown block epochs remain intact. The caller owns source
     * identity, duplicate-row rejection and matching spatial/GPU append ordering.
     * No allocation growth, eviction or implicit recomputation is performed. */
    appendUploaded(source: PreparedCatalogElements, startRow: number, maximumSpeedAUPerTtDay: number | null, julianDay: number) {
      if (!sealed) throw new RangeError('Uploaded catalog extension requires a sealed snapshot')
      appendSource(source, startRow, maximumSpeedAUPerTtDay, julianDay)
    },
    seal(expectedRows: number, julianDay: number) {
      if (computing || sealed || expectedRows !== count || !Number.isFinite(julianDay) || julianDay < 2441317.5) throw new RangeError('Retained catalog row count or epoch differs from uploaded snapshot')
      blockEpochs.fill(julianDay, 0, blocks)
      sealed = true
    },
    /** Diagnostic/admission plan owns its arrays. No output positions or
     * source ordering change here; unknown epochs/caps always require compute. */
    planEpoch(julianDay: number, maximumDriftAU: number) {
      if (!sealed || computing || !Number.isFinite(julianDay) || julianDay < 2441317.5 ||
          !Number.isFinite(maximumDriftAU) || maximumDriftAU < 0 || maximumDriftAU > 1) throw new RangeError('Invalid retained block epoch plan')
      const reuse = new Uint8Array(blocks), displacementAU = new Float64Array(blocks)
      let reusedRows = 0, recomputedRows = 0
      for (let block = 0; block < blocks; block++) {
        const drift = catalogTemporalDisplacementAU(blockEpochs[block], julianDay, Number.isFinite(speeds[block]) ? speeds[block] : null)
        displacementAU[block] = drift ?? NaN
        const accepted = drift !== null && (blockEpochs[block] === julianDay || maximumDriftAU > 0 && drift <= maximumDriftAU)
        reuse[block] = accepted ? 1 : 0
        if (accepted) reusedRows += counts[block]
        else recomputedRows += counts[block]
      }
      return { julianDay, maximumDriftAU, starts: starts.slice(0, blocks), counts: counts.slice(0, blocks),
        computedJulianDays: blockEpochs.slice(0, blocks), displacementAU, reuse, reusedRows, recomputedRows }
    },
    async computeEpoch(options: {
      julianDay: number
      signal: AbortSignal
      superseded: () => boolean
      yieldControl: () => Promise<void>
      tileRows?: number
      maximumDriftAU?: number
      onReuse?: (block: CatalogEpochReuse) => Promise<void>
      // Consumer returns ownership of the same-capacity buffer after upload.
      // At most CATALOG_EPOCH_UPLOAD_SLOTS tiles can be awaiting that ACK.
      onTile: (tile: CatalogEpochTile) => Promise<Float64Array>
    }): Promise<CatalogEpochResult | null> {
      // Keep one epoch/budget and callback set throughout cooperative compute.
      // The captured signal and superseded callback remain live cancellation
      // channels; changing the caller's options object must not relabel output.
      options = { ...options }
      if (!sealed || computing) throw new Error('Retained catalog is unavailable or already computing')
      const tileRows = options.tileRows ?? CATALOG_EPOCH_TILE_ROWS
      if (!Number.isSafeInteger(tileRows) || tileRows < 1 || tileRows > 16384 ||
          !Number.isFinite(options.julianDay) || options.julianDay < 2441317.5) throw new RangeError('Invalid retained epoch or compute tile budget')
      options.signal.throwIfAborted()
      if (options.superseded()) return null
      const workerStartedAt = performance.now()
      let computeAndYieldMs = 0, propagationMs = 0, cooperativeYieldMs = 0
      let tileOwnershipWaitMs = 0, reuseAckWaitMs = 0
      let unacknowledgedTiles = 0, peakUnacknowledgedTiles = 0
      let propagationWorkspace: CatalogPointWorkspace | undefined
      const plan = options.onReuse ? this.planEpoch(options.julianDay, options.maximumDriftAU ?? 0) : null
      const epochTt = utcJulianDayToTt(options.julianDay)
      computing = true
      // Existing whole-frame compute can publish a prefix before cancellation.
      // Invalidate all block epochs until the complete ownership-return chain
      // finishes, rather than allowing that prefix to be reused as old data.
      if (!plan) blockEpochs.fill(NaN, 0, blocks)
      try {
        const availableBuffers: Float64Array[] = []
        const computeRange = async (rangeStart: number, rangeEnd: number) => {
          const pendingTiles: Promise<void>[] = []
          let complete = true
          try {
            for (let start = rangeStart; start < rangeEnd; start += tileRows) {
              options.signal.throwIfAborted()
              if (options.superseded()) { complete = false; break }
              if (pendingTiles.length >= CATALOG_EPOCH_UPLOAD_SLOTS) await pendingTiles.shift()!
              options.signal.throwIfAborted()
              if (options.superseded()) { complete = false; break }
              const end = Math.min(rangeEnd, start+tileRows), elements = (end-start)*dimensions
              const scratch = availableBuffers.pop()
              const output = scratch?.length === elements ? scratch : new Float64Array(elements)
              const workspace = propagationWorkspace ?? (propagationWorkspace = createCatalogPointWorkspace())
              const computeStartedAt = performance.now()
              let sourceBlock = findBlock(start)
              // Yield between bounded source ranges. A changed epoch can abandon
              // this incomplete tile without publishing a mixed-time tile.
              for (let row = start; row < end; row += 256) {
                const sliceEnd = Math.min(end, row+256)
                const propagationStartedAt = performance.now()
                sourceBlock = propagateRange(row,sliceEnd,epochTt,
                  output.subarray((row-start)*dimensions,(sliceEnd-start)*dimensions),sourceBlock,workspace)
                const propagationFinishedAt = performance.now()
                propagationMs += propagationFinishedAt-propagationStartedAt
                await options.yieldControl()
                cooperativeYieldMs += performance.now()-propagationFinishedAt
                options.signal.throwIfAborted()
                if (options.superseded()) { complete = false; break }
              }
              if (!complete) break
              computeAndYieldMs += performance.now()-computeStartedAt
              const ownershipWaitStartedAt = performance.now()
              const ownership = options.onTile({ startRow: start, count: end-start, julianDay: options.julianDay, positions: output })
              unacknowledgedTiles++
              peakUnacknowledgedTiles = Math.max(peakUnacknowledgedTiles, unacknowledgedTiles)
              const pending = ownership.then(recycled => {
                tileOwnershipWaitMs += performance.now()-ownershipWaitStartedAt
                unacknowledgedTiles--
                options.signal.throwIfAborted()
                if (!(recycled instanceof Float64Array) || recycled.length !== elements || recycled.byteOffset !== 0 ||
                    !(recycled.buffer instanceof ArrayBuffer) || recycled.buffer.byteLength !== elements*8) throw new RangeError('Temporal upload did not return its bounded Float64 buffer')
                if (availableBuffers.length < CATALOG_EPOCH_UPLOAD_SLOTS) availableBuffers.push(recycled)
              }, error => {
                tileOwnershipWaitMs += performance.now()-ownershipWaitStartedAt
                unacknowledgedTiles--
                throw error
              })
              // A later compute slice can run while an earlier tile is uploaded.
              // The rejection remains observed even if it occurs during a yield.
              void pending.catch(() => undefined)
              pendingTiles.push(pending)
            }
          } catch (error) {
            await Promise.allSettled(pendingTiles)
            throw error
          }
          const settled = await Promise.allSettled(pendingTiles)
          const failedTile = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
          if (failedTile) throw failedTile.reason
          // A stale ACK may only return ownership, without applying positions.
          // Such a block must keep its invalidated epoch and be recomputed.
          return complete && !options.superseded()
        }
        let reusedRows = 0, recomputedRows = 0, maximumDisplacementAU = 0
        if (plan) {
          let block = 0
          while (block < blocks) {
            options.signal.throwIfAborted()
            if (options.superseded()) return null
            if (plan.reuse[block]) {
              const reuseWaitStartedAt = performance.now()
              await options.onReuse!({ startRow: starts[block], count: counts[block], julianDay: options.julianDay,
                computedJulianDay: plan.computedJulianDays[block], displacementAU: plan.displacementAU[block] })
              reuseAckWaitMs += performance.now()-reuseWaitStartedAt
              reusedRows += counts[block]; maximumDisplacementAU = Math.max(maximumDisplacementAU, plan.displacementAU[block])
              block++
            } else {
              // Coalesce adjacent rows that all require recomputation. This
              // preserves the existing two-tile compute/upload overlap even
              // though reuse decisions now have finer speed bounds.
              const firstBlock = block, rangeStart = starts[block]
              let rangeEnd = rangeStart+counts[block]
              while (block+1 < blocks && !plan.reuse[block+1] && starts[block+1] === rangeEnd) {
                block++
                rangeEnd = starts[block]+counts[block]
              }
              const lastBlock = block
              for (let current = firstBlock; current <= lastBlock; current++) blockEpochs[current] = NaN
              if (!await computeRange(rangeStart,rangeEnd)) return null
              for (let current = firstBlock; current <= lastBlock; current++) blockEpochs[current] = options.julianDay
              recomputedRows += rangeEnd-rangeStart
              block++
            }
            // Recomputed tiles already yield during each 256-row slice, and a
            // reused block waits for its ownership ACK. Keep synchronous API
            // callers cooperative without adding one extra handoff per tile.
            if (block > 0 && block % 64 === 0 && block < blocks) await options.yieldControl()
          }
        } else {
          if (!await computeRange(0, count)) return null
          blockEpochs.fill(options.julianDay, 0, blocks); recomputedRows = count
        }
        options.signal.throwIfAborted()
        if (options.superseded()) return null
        let minimumEpoch = Infinity, maximumEpoch = -Infinity
        const evidence = new Float64Array(blocks*4)
        for (let block = 0; block < blocks; block++) {
          minimumEpoch = Math.min(minimumEpoch, blockEpochs[block]); maximumEpoch = Math.max(maximumEpoch, blockEpochs[block])
          const drift = catalogTemporalDisplacementAU(blockEpochs[block], options.julianDay, Number.isFinite(speeds[block]) ? speeds[block] : null)
          if (drift === null) throw new Error('Completed catalog block has no temporal displacement evidence')
          evidence.set([starts[block], counts[block], blockEpochs[block], drift], block*4)
        }
        return { count, julianDay: options.julianDay, reusedRows, recomputedRows, maximumDisplacementAU,
          computedEpochRange: blocks ? [minimumEpoch, maximumEpoch] : null,
          maximumDriftAU: plan ? options.maximumDriftAU ?? 0 : 0, blockEpochs: evidence,
          workerTimingMs: { computeAndYield: computeAndYieldMs, propagation: propagationMs, cooperativeYield: cooperativeYieldMs,
            tileOwnershipWait: tileOwnershipWaitMs,
            reuseAckWait: reuseAckWaitMs, tileRows, maxUnacknowledgedTiles: CATALOG_EPOCH_UPLOAD_SLOTS, peakUnacknowledgedTiles,
            total: performance.now()-workerStartedAt } }
      } finally { computing = false }
    },
  }
}
