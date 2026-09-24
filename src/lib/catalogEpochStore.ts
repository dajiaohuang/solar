import { PREPARED_CATALOG_STRIDE, propagatePreparedCatalogTile, type CatalogPointMode, type PreparedCatalogElements } from '../engine/ephemeris/catalogPoints'
import { utcJulianDayToTt } from '../engine/ephemeris/timeScales'
import { catalogTemporalDisplacementAU } from '../engine/ephemeris/catalogTemporalBudget'

export type CatalogEpochTile = { startRow: number; count: number; julianDay: number; positions: Float64Array }
export type CatalogEpochReuse = { startRow: number; count: number; julianDay: number; computedJulianDay: number; displacementAU: number }
export type CatalogEpochResult = { count: number; julianDay: number; reusedRows: number; recomputedRows: number; maximumDisplacementAU: number; computedEpochRange: [number, number] | null;
  maximumDriftAU: number; blockEpochs: Float64Array }

/** Owns only prepared Float64 source coefficients, in original upload order.
 * Capacity must come from planCatalogStream(..., retainEpochs=true). It never
 * retains metadata, raw shards, a second catalog or a full output frame. */
export function createCatalogEpochStore(capacity: number, mode: CatalogPointMode, maximumBlocks: number) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity*PREPARED_CATALOG_STRIDE*8 > 512*1024*1024 ||
      (mode !== '2d' && mode !== '3d') || !Number.isSafeInteger(maximumBlocks) || maximumBlocks < 1 || maximumBlocks > 65536+256) throw new RangeError('Invalid retained catalog capacity or dimension')
  const prepared: PreparedCatalogElements = { count: capacity, data: new Float64Array(capacity*PREPARED_CATALOG_STRIDE) }
  const dimensions = mode === '3d' ? 3 : 2
  const starts = new Uint32Array(maximumBlocks), counts = new Uint32Array(maximumBlocks)
  const speeds = new Float64Array(maximumBlocks), blockEpochs = new Float64Array(maximumBlocks)
  let blocks = 0
  let count = 0, sealed = false, computing = false
  const appendSource = (source: PreparedCatalogElements, startRow: number,
    maximumSpeedAUPerTtDay: number | null, uploadedJulianDay: number | null) => {
    if (computing || sealed !== (uploadedJulianDay !== null) || startRow !== count ||
        !Number.isSafeInteger(source.count) || source.count < 0 ||
        !(source.data instanceof Float64Array) || source.data.length !== source.count*PREPARED_CATALOG_STRIDE ||
        count+source.count > capacity) throw new RangeError('Invalid retained catalog source append')
    if (uploadedJulianDay !== null && (!Number.isFinite(uploadedJulianDay) || uploadedJulianDay < 2441317.5)) {
      throw new RangeError('Invalid appended catalog upload epoch')
    }
    // Complete admission before modifying coefficients or existing block evidence.
    if (!source.data.every(Number.isFinite)) throw new RangeError('Nonfinite retained catalog coefficients')
    if (source.count && blocks >= maximumBlocks) throw new RangeError('Retained catalog source-block capacity exceeded')
    if (maximumSpeedAUPerTtDay !== null && (!Number.isFinite(maximumSpeedAUPerTtDay) || maximumSpeedAUPerTtDay <= 0)) throw new RangeError('Invalid retained source speed cap')
    prepared.data.set(source.data, count*PREPARED_CATALOG_STRIDE)
    if (source.count) {
      starts[blocks] = count; counts[blocks] = source.count
      speeds[blocks] = maximumSpeedAUPerTtDay ?? NaN
      blockEpochs[blocks] = uploadedJulianDay ?? NaN
      blocks++
    }
    count += source.count
  }
  return {
    capacity, retainedBytes: prepared.data.byteLength+maximumBlocks*24,
    get count() { return count },
    get ready() { return sealed },
    append(source: PreparedCatalogElements, startRow: number, maximumSpeedAUPerTtDay: number | null) {
      appendSource(source, startRow, maximumSpeedAUPerTtDay, null)
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
      // Consumer must finish reading/uploading before resolving and return
      // ownership of the same-capacity buffer (e.g. transfer it back on ACK).
      // Consumer must reject/settle on cancellation; at most one tile is held.
      onTile: (tile: CatalogEpochTile) => Promise<Float64Array>
    }): Promise<CatalogEpochResult | null> {
      // Keep one epoch/budget and callback set throughout cooperative compute.
      // The captured signal and superseded callback remain live cancellation
      // channels; changing the caller's options object must not relabel output.
      options = { ...options }
      if (!sealed || computing) throw new Error('Retained catalog is unavailable or already computing')
      const tileRows = options.tileRows ?? 1024
      if (!Number.isSafeInteger(tileRows) || tileRows < 1 || tileRows > 16384 ||
          !Number.isFinite(options.julianDay) || options.julianDay < 2441317.5) throw new RangeError('Invalid retained epoch or compute tile budget')
      options.signal.throwIfAborted()
      if (options.superseded()) return null
      const plan = options.onReuse ? this.planEpoch(options.julianDay, options.maximumDriftAU ?? 0) : null
      const epochTt = utcJulianDayToTt(options.julianDay)
      computing = true
      // Existing whole-frame compute can publish a prefix before cancellation.
      // Invalidate all block epochs until the complete ownership-return chain
      // finishes, rather than allowing that prefix to be reused as old data.
      if (!plan) blockEpochs.fill(NaN, 0, blocks)
      try {
        let scratch: Float64Array = new Float64Array(0)
        const computeRange = async (rangeStart: number, rangeEnd: number) => {
          for (let start = rangeStart; start < rangeEnd; start += tileRows) {
            options.signal.throwIfAborted()
            if (options.superseded()) return false
            const end = Math.min(rangeEnd, start+tileRows), elements = (end-start)*dimensions
            if (scratch.length !== elements) scratch = new Float64Array(elements)
            // Yield between bounded source ranges. A changed epoch can abandon
            // this incomplete tile without publishing a mixed-time tile.
            for (let row = start; row < end; row += 256) {
              const sliceEnd = Math.min(end, row+256)
              propagatePreparedCatalogTile(prepared, epochTt, mode, row, sliceEnd,
                scratch.subarray((row-start)*dimensions, (sliceEnd-start)*dimensions))
              await options.yieldControl()
              options.signal.throwIfAborted()
              if (options.superseded()) return false
            }
            const recycled = await options.onTile({ startRow: start, count: end-start, julianDay: options.julianDay, positions: scratch })
            options.signal.throwIfAborted()
            if (!(recycled instanceof Float64Array) || recycled.length !== elements || recycled.byteOffset !== 0 ||
                !(recycled.buffer instanceof ArrayBuffer) || recycled.buffer.byteLength !== elements*8) throw new RangeError('Temporal upload did not return its bounded Float64 buffer')
            scratch = recycled
          }
          // A stale ACK may only return ownership, without applying positions.
          // Such a block must keep its invalidated epoch and be recomputed.
          return !options.superseded()
        }
        let reusedRows = 0, recomputedRows = 0, maximumDisplacementAU = 0
        if (plan) {
          for (let block = 0; block < blocks; block++) {
            options.signal.throwIfAborted()
            if (options.superseded()) return null
            if (plan.reuse[block]) {
              await options.onReuse!({ startRow: starts[block], count: counts[block], julianDay: options.julianDay,
                computedJulianDay: plan.computedJulianDays[block], displacementAU: plan.displacementAU[block] })
              reusedRows += counts[block]; maximumDisplacementAU = Math.max(maximumDisplacementAU, plan.displacementAU[block])
            } else {
              blockEpochs[block] = NaN
              if (!await computeRange(starts[block], starts[block]+counts[block])) return null
              blockEpochs[block] = options.julianDay; recomputedRows += counts[block]
            }
            await options.yieldControl()
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
          maximumDriftAU: plan ? options.maximumDriftAU ?? 0 : 0, blockEpochs: evidence }
      } finally { computing = false }
    },
  }
}
