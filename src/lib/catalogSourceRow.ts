import type { CatalogLocator } from '../types'
import type { CatalogSourceSelection } from './catalogStreaming'

function population(value: number) {
  const pairs = value-((value >>> 1)&0x55), groups = (pairs&0x33)+((pairs >>> 2)&0x33)
  return (groups+(groups >>> 4))&0x0f
}

export const CATALOG_SOURCE_RANK_BLOCK_BYTES = 256

/** Build once for checked, immutable upload masks; never mutate those masks
 * during this lookup's lifetime. Offsets follow upload order, not chunk number. */
export function createCatalogSourceRowLookup(selection: CatalogSourceSelection) {
  if (selection.shards.length > 65_536) throw new RangeError('Too many catalog source shards')
  const shards = new Map<number, { mask: Uint8Array; prefix: Uint32Array; offset: number }>()
  let offset = 0
  for (const shard of selection.shards) {
    const mask = shard.selectedRows
    if (!Number.isSafeInteger(shard.chunk) || shard.chunk < 0 || shard.chunk >= 65_536 ||
        shards.has(shard.chunk) || !(mask instanceof Uint8Array) || mask.length > 8192) {
      throw new RangeError('Invalid catalog source rank shard')
    }
    const prefix = new Uint32Array(Math.ceil(mask.length / CATALOG_SOURCE_RANK_BLOCK_BYTES))
    let count = 0
    for (let byte = 0; byte < mask.length; byte++) {
      if (byte % CATALOG_SOURCE_RANK_BLOCK_BYTES === 0) prefix[byte / CATALOG_SOURCE_RANK_BLOCK_BYTES] = count
      count += population(mask[byte])
    }
    shards.set(shard.chunk, { mask, prefix, offset })
    offset += count
  }
  const row = (locator: CatalogLocator): number | undefined => {
    if (!Number.isSafeInteger(locator.chunkIndex) || locator.chunkIndex < 0 ||
        !Number.isSafeInteger(locator.rowIndex) || locator.rowIndex < 0) return undefined
    const shard = shards.get(locator.chunkIndex)
    if (!shard) return undefined
    const byte = Math.floor(locator.rowIndex / 8), bit = locator.rowIndex & 7
    if (byte >= shard.mask.length || !(shard.mask[byte] & (1 << bit))) return undefined
    const block = Math.floor(byte / CATALOG_SOURCE_RANK_BLOCK_BYTES)
    let rank = shard.offset + shard.prefix[block]
    for (let index = block * CATALOG_SOURCE_RANK_BLOCK_BYTES; index < byte; index++) rank += population(shard.mask[index])
    return rank + population(shard.mask[byte] & ((1 << bit) - 1))
  }
  return {
    count: offset,
    row,
    rows(locators: readonly CatalogLocator[]): (number | undefined)[] {
      if (locators.length > 256) throw new RangeError('Catalog selection mapping accepts at most 256 locators')
      return locators.map(row)
    },
  }
}

/** Resolve a source locator only through the checked upload-order masks. */
export function catalogUploadedRow(selection: CatalogSourceSelection, locator: CatalogLocator): number | undefined {
  if (!Number.isSafeInteger(locator.chunkIndex) || locator.chunkIndex < 0 || !Number.isSafeInteger(locator.rowIndex) || locator.rowIndex < 0) return undefined
  let start = 0
  for (const shard of selection.shards) {
    if (shard.chunk === locator.chunkIndex) {
      const byte = Math.floor(locator.rowIndex/8), bit = locator.rowIndex&7
      if (byte >= shard.selectedRows.length || !(shard.selectedRows[byte] & (1 << bit))) return undefined
      for (let index = 0; index < byte; index++) start += population(shard.selectedRows[index])
      return start + population(shard.selectedRows[byte] & ((1 << bit)-1))
    }
    for (const value of shard.selectedRows) start += population(value)
  }
  return undefined
}

/** Resolve a bounded group with one bitmap scan, preserving caller order. */
export function catalogUploadedRows(selection: CatalogSourceSelection, locators: readonly CatalogLocator[]): (number | undefined)[] {
  if (locators.length > 256) throw new RangeError('Catalog selection mapping accepts at most 256 locators')
  const output: (number | undefined)[] = new Array(locators.length).fill(undefined)
  const groups = new Map<number, { row: number; index: number }[]>()
  locators.forEach((locator, index) => {
    if (!Number.isSafeInteger(locator.chunkIndex) || locator.chunkIndex < 0 || !Number.isSafeInteger(locator.rowIndex) || locator.rowIndex < 0) return
    const group = groups.get(locator.chunkIndex) ?? []
    group.push({ row: locator.rowIndex, index }); groups.set(locator.chunkIndex, group)
  })
  let offset = 0
  for (const shard of selection.shards) {
    const group = groups.get(shard.chunk)?.sort((a, b) => a.row-b.row) ?? []
    let cursor = 0
    for (let byte = 0; byte < shard.selectedRows.length; byte++) {
      const value = shard.selectedRows[byte]
      while (cursor < group.length && Math.floor(group[cursor].row/8) === byte) {
        const target = group[cursor++], bit = target.row&7
        if (value & (1 << bit)) output[target.index] = offset+population(value & ((1 << bit)-1))
      }
      offset += population(value)
    }
  }
  return output
}
