import type { CatalogLocator } from '../types'
import type { CatalogSourceSelection } from './catalogStreaming'
import { createCatalogSourceRowLookup } from './catalogSourceRow'

/** Bounded selected-object extension over an immutable, checked base upload.
 * New rows retain batch order, even when their shard appeared in an earlier
 * upload. This does not merge masks, which would renumber existing GPU rows.
 * The caller must coordinate GPU/epoch admission before publishing the layout.
 */
export function createCatalogSourceAppendLookup(base: CatalogSourceSelection, capacity: number) {
  const initial = createCatalogSourceRowLookup(base)
  if (!Number.isSafeInteger(capacity) || capacity < initial.count || capacity > 0xffffffff) {
    throw new RangeError('Invalid catalog append row capacity')
  }
  const contentSha256 = base.contentSha256, indexSha256 = base.indexSha256
  // Reuse the immutable base records; additional records contain no masks.
  const baseShards = new Map(base.shards.map(shard => [shard.chunk, shard]))
  const additionalSources = new Map<number, { sha256: string; metadataSha256: string; maskBytes: number }>()
  const added = new Map<number, number>()
  let reservation: object | null = null
  const key = (locator: CatalogLocator) => {
    if (!Number.isSafeInteger(locator.chunkIndex) || locator.chunkIndex < 0 || locator.chunkIndex >= 65536 ||
        !Number.isSafeInteger(locator.rowIndex) || locator.rowIndex < 0 || locator.rowIndex >= 65536) return undefined
    return locator.chunkIndex*65536+locator.rowIndex
  }
  const row = (locator: CatalogLocator) => {
    const identity = key(locator)
    return identity === undefined ? undefined : initial.row(locator) ?? added.get(identity)
  }
  return {
    get count() { return initial.count+added.size },
    row,
    rows(locators: readonly CatalogLocator[]) {
      if (locators.length > 256) throw new RangeError('Catalog selection mapping accepts at most 256 locators')
      return locators.map(row)
    },
    /** Reserve one batch without exposing rows before upload acknowledgement.
     * Commit after successful GPU/epoch admission; cancel on every other path.
     * At most one reservation and 256 added bodies exist over this lifetime.
     * Validation failures leave every existing row and source record intact.
     * Hash equality binds source identity, not artifact authenticity; upstream
     * must still verify hashes, filters, row bounds and actual uploaded data.
     */
    prepareAppend(selection: CatalogSourceSelection, expectedStartRow: number) {
      if (reservation) throw new RangeError('Catalog append already awaits upload acknowledgement')
      if (expectedStartRow !== initial.count+added.size || selection.contentSha256 !== contentSha256 ||
          selection.indexSha256 !== indexSha256 || !selection.shards.length || selection.shards.length > 256) {
        throw new RangeError('Catalog append differs from its source or upload order')
      }
      const pending = new Map<number,number>()
      const sources = new Map<number, { sha256: string; metadataSha256: string; maskBytes: number }>()
      for (const shard of selection.shards) {
        const mask = shard.selectedRows
        if (!Number.isSafeInteger(shard.chunk) || shard.chunk < 0 || shard.chunk >= 65536 || sources.has(shard.chunk) ||
            !(mask instanceof Uint8Array) || !mask.length || mask.length > 8192 ||
            !/^[a-f0-9]{64}$/.test(shard.sha256) || !/^[a-f0-9]{64}$/.test(shard.metadataSha256)) {
          throw new RangeError('Invalid catalog append source shard')
        }
        const original = baseShards.get(shard.chunk), previous = additionalSources.get(shard.chunk)
        const known = original ? { ...original, maskBytes: original.selectedRows.length } : previous
        if (known && (known.sha256 !== shard.sha256 || known.metadataSha256 !== shard.metadataSha256 || known.maskBytes !== mask.length)) {
          throw new RangeError('Catalog append shard identity changed')
        }
        const before = pending.size
        for (let byte=0;byte<mask.length;byte++) {
          let bits = mask[byte]
          while (bits) {
            const bit = 31-Math.clz32(bits&-bits), rowIndex = byte*8+bit
            const locator = { chunkIndex: shard.chunk, rowIndex }, identity = shard.chunk*65536+rowIndex
            if (row(locator) !== undefined || pending.has(identity)) throw new RangeError('Catalog append repeats an uploaded body')
            if (added.size+pending.size >= 256 || expectedStartRow+pending.size >= capacity) {
              throw new RangeError('Catalog append exceeds its fixed row budget')
            }
            pending.set(identity,expectedStartRow+pending.size)
            bits &= bits-1
          }
        }
        if (pending.size === before) throw new RangeError('Empty catalog append shard')
        sources.set(shard.chunk,{sha256:shard.sha256,metadataSha256:shard.metadataSha256,maskBytes:mask.length})
      }
      const ticket = {}, count = pending.size
      reservation = ticket
      const release = () => {
        pending.clear(); sources.clear()
        if (reservation === ticket) reservation = null
      }
      return {
        startRow: expectedStartRow,
        count,
        commit(acknowledgedStartRow: number, acknowledgedCount: number) {
          if (reservation !== ticket) throw new RangeError('Catalog append reservation is no longer active')
          if (acknowledgedStartRow !== expectedStartRow || acknowledgedCount !== count ||
              initial.count+added.size !== expectedStartRow) {
            release()
            throw new RangeError('Catalog append acknowledgement differs from its reservation')
          }
          for (const [identity, uploadRow] of pending) added.set(identity,uploadRow)
          for (const [chunk, source] of sources) additionalSources.set(chunk,source)
          release()
        },
        cancel: release,
      }
    },
  }
}
