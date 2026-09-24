import type { AsteroidManifest, CatalogLocator } from '../types'
import type { CatalogStreamResult } from './catalogStreaming'
import { checkCatalogReadEvidence } from './catalogReadEvidence'

/** Bounded structural/source binding. Does not recompute positions or filters. */
export function checkCatalogAppendReceipt(result: CatalogStreamResult, request: {
  manifest: AsteroidManifest; locators: readonly CatalogLocator[]; maximumRows: number
  contentSha256: string; indexSha256: string
}) {
  const requireValue = (value: boolean) => { if (!value) throw new Error('Catalog append receipt differs from its requested sources') }
  const { manifest, maximumRows } = request
  checkCatalogReadEvidence(result.reads,manifest)
  requireValue(Number.isSafeInteger(maximumRows) && maximumRows > 0 && maximumRows <= 256 &&
    request.locators.length > 0 && request.locators.length <= 256)
  const candidates = new Set<number>(), candidateShards = new Set<number>()
  for (const locator of request.locators) {
    requireValue(Number.isSafeInteger(locator.chunkIndex) && locator.chunkIndex >= 0 && locator.chunkIndex < manifest.chunkCount &&
      Number.isSafeInteger(locator.rowIndex) && locator.rowIndex >= 0 && locator.rowIndex < manifest.chunkSize &&
      locator.chunkIndex*manifest.chunkSize+locator.rowIndex < manifest.totalCount)
    const key = locator.chunkIndex*65536+locator.rowIndex
    requireValue(!candidates.has(key)); candidates.add(key); candidateShards.add(locator.chunkIndex)
  }
  const selection = result.sourceSelection, screening = result.screening
  requireValue(Boolean(selection) && selection!.contentSha256 === request.contentSha256 &&
    selection!.contentSha256 === manifest.contentSha256 && selection!.indexSha256 === request.indexSha256 &&
    /^[a-f0-9]{64}$/.test(request.contentSha256) && /^[a-f0-9]{64}$/.test(request.indexSha256))
  requireValue(Number.isSafeInteger(result.drawnRows) && result.drawnRows >= 0 && result.drawnRows <= maximumRows &&
    Number.isSafeInteger(result.sourceRows) && result.sourceRows >= 0 && result.sourceRows <= manifest.totalCount &&
    typeof result.complete === 'boolean' && Array.isArray(selection!.shards) && selection!.shards.length <= candidates.size &&
    Boolean(screening) && Array.isArray(screening.shards) && screening.shards.length <= candidateShards.size)
  requireValue(Number.isSafeInteger(screening.admittedShards) && screening.admittedShards >= screening.shards.length &&
    screening.admittedShards <= candidateShards.size && screening.completionReason === (result.complete ? 'exhausted' : 'capacity') &&
    (result.complete || result.drawnRows === maximumRows))
  const seen = new Set<number>()
  let sourceRows = 0, drawnRows = 0, metadataRows = 0, completedShards = 0, selectedShard = 0
  for (const shard of screening.shards) {
    requireValue(candidateShards.has(shard.chunk) && !seen.has(shard.chunk) && /^[a-f0-9]{64}$/.test(shard.metadataSha256))
    seen.add(shard.chunk)
    const rows = Math.min(manifest.chunkSize,manifest.totalCount-shard.chunk*manifest.chunkSize)
    requireValue(Number.isSafeInteger(shard.examinedRows) && shard.examinedRows > 0 && shard.examinedRows <= rows &&
      Number.isSafeInteger(shard.selectedRows) && shard.selectedRows >= 0 && shard.selectedRows <= shard.examinedRows)
    if (shard.outcome === 'metadata-rejected') {
      requireValue(shard.binarySha256 === null && shard.selectedRows === 0 && shard.examinedRows === rows)
      metadataRows += rows
    } else requireValue(shard.outcome === 'source-screened' && /^[a-f0-9]{64}$/.test(shard.binarySha256 ?? ''))
    if (shard.examinedRows === rows) completedShards++
    sourceRows += shard.examinedRows; drawnRows += shard.selectedRows
    if (!shard.selectedRows) continue
    const mapped = selection!.shards[selectedShard++]
    requireValue(Boolean(mapped) && mapped.chunk === shard.chunk && mapped.sha256 === shard.binarySha256 &&
      mapped.metadataSha256 === shard.metadataSha256 && mapped.selectedRows instanceof Uint8Array && mapped.selectedRows.length === Math.ceil(rows/8))
    let selected = 0
    for (let byte=0;byte<mapped.selectedRows.length;byte++) {
      let bits = mapped.selectedRows[byte]
      while (bits) {
        const bit = 31-Math.clz32(bits&-bits), row = byte*8+bit
        // Source screening visits a contiguous prefix, even when selection is
        // sparse. A capacity stop cannot attest to any later source row.
        requireValue(row < shard.examinedRows && candidates.has(shard.chunk*65536+row))
        selected++; bits &= bits-1
      }
    }
    requireValue(selected === shard.selectedRows)
  }
  requireValue(sourceRows === result.sourceRows && drawnRows === result.drawnRows && selectedShard === selection!.shards.length &&
    metadataRows === screening.metadataOnlyRows && completedShards === screening.completedShards &&
    (!result.complete || completedShards === screening.admittedShards))
  const speed = result.maximumSpeedAUPerTtDay
  requireValue(speed === null || typeof speed === 'number' && Number.isFinite(speed) && speed > 0)
  return selection!
}
