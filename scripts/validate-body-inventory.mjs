#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digest, verifySnapshot } from './lib/inventory-snapshot.mjs'

const INVENTORY_SCHEMA_VERSION = 2
const INVENTORY_FORMAT = 'jsonl-deterministic-gzip-blocks-v2'
const INVENTORY_BLOCK_ROWS = 128
const MAX_SHARD_BYTES = 64 * 1024 * 1024
const MAX_BLOCK_BYTES = 8 * 1024 * 1024
const MAX_BLOCK_RAW_BYTES = 16 * 1024 * 1024
const MAX_SHARDS = 10000
const SHA256 = /^[0-9a-f]{64}$/

const isInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum
const requireDigest = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`Invalid ${label} digest`)
}

export async function validateInventory(directory, sourceDirectory, { onRecord } = {}) {
  const manifestBytes = await readFile(join(directory, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes)
  if (manifest.schemaVersion !== INVENTORY_SCHEMA_VERSION || manifest.purpose !== 'source-inventory-addressable-v2' || (manifest.format !== undefined && manifest.format !== INVENTORY_FORMAT) || (manifest.blockRows !== undefined && manifest.blockRows !== INVENTORY_BLOCK_ROWS) || !Array.isArray(manifest.shards) || !manifest.shards.length || manifest.shards.length > MAX_SHARDS) throw new Error('Invalid inventory manifest')
  if (!isInteger(manifest.totalRecords) || !manifest.counts || typeof manifest.counts !== 'object' || !manifest.expectedCounts || typeof manifest.expectedCounts !== 'object' || !Array.isArray(manifest.missingParents)) throw new Error('Invalid inventory manifest')
  if (sourceDirectory) {
    const actual = await verifySnapshot(sourceDirectory)
    if (JSON.stringify(actual) !== JSON.stringify(manifest.snapshot)) throw new Error('Inventory does not match source snapshot')
  }
  const ids = new Set(), counts = { sources: {}, categories: {}, geometry: {}, ephemerides: {}, confirmations: {}, identities: {} }, parents = new Set()
  const increment = (group, value) => { if (typeof value !== 'string' || !value) throw new Error(`Missing ${group}`); counts[group][value] = (counts[group][value] ?? 0) + 1 }
  let total = 0
  const files = new Set()
  for (const shard of manifest.shards) {
    if (!shard || typeof shard !== 'object' || !/^records-\d{5}\.jsonl\.bgz$/.test(shard.file) || files.has(shard.file)) throw new Error('Invalid or duplicate shard path')
    if (!isInteger(shard.count, 1) || shard.count > 10000 || !isInteger(shard.bytes, 1) || shard.bytes > MAX_SHARD_BYTES || (shard.uncompressedBytes !== undefined && !isInteger(shard.uncompressedBytes, 1)) || !Array.isArray(shard.blocks) || !shard.blocks.length) throw new Error(`Invalid shard metadata: ${shard.file}`)
    requireDigest(shard.sha256, `shard ${shard.file}`)
    files.add(shard.file)
    const bytes = await readFile(join(directory, shard.file))
    if (bytes.length !== shard.bytes || digest(bytes) !== shard.sha256) throw new Error(`Shard integrity mismatch: ${shard.file}`)
    let rowStart = 0
    let offset = 0
    let uncompressedBytes = 0
    for (const block of shard.blocks) {
      if (!block || typeof block !== 'object' || !isInteger(block.rowStart) || block.rowStart !== rowStart || !isInteger(block.count, 1) || block.count > INVENTORY_BLOCK_ROWS || !isInteger(block.offset) || block.offset !== offset || !isInteger(block.bytes, 1) || block.bytes > MAX_BLOCK_BYTES || !isInteger(block.uncompressedBytes, 1) || block.uncompressedBytes > MAX_BLOCK_RAW_BYTES) throw new Error(`Invalid block metadata: ${shard.file}`)
      requireDigest(block.sha256, `block ${shard.file}:${block.rowStart}`)
      if (block.offset + block.bytes > bytes.length) throw new Error(`Block bounds mismatch: ${shard.file}`)
      const compressed = bytes.subarray(block.offset, block.offset + block.bytes)
      if (digest(compressed) !== block.sha256) throw new Error(`Block integrity mismatch: ${shard.file}:${block.rowStart}`)
      let decoded
      try {
        decoded = gunzipSync(compressed, { maxOutputLength: MAX_BLOCK_RAW_BYTES })
      } catch (error) {
        throw new Error(`Invalid gzip block: ${shard.file}:${block.rowStart}`, { cause: error })
      }
      if (decoded.length !== block.uncompressedBytes || !decoded.length || decoded[decoded.length - 1] !== 0x0a) throw new Error(`Block size or newline mismatch: ${shard.file}:${block.rowStart}`)
      const lines = decoded.subarray(0, -1).toString('utf8').split('\n')
      if (lines.length !== block.count) throw new Error(`Block count mismatch: ${shard.file}:${block.rowStart}`)
      for (const line of lines) {
        let record
        try { record = JSON.parse(line) } catch (error) { throw new Error(`Invalid inventory record: ${shard.file}:${block.rowStart}`, { cause: error }) }
      if (typeof record.id !== 'string' || !record.id || ids.has(record.id)) throw new Error(`Duplicate or missing record identity: ${record.id}`)
      ids.add(record.id); total++
      if (record.category === 'moon' || record.category === 'small-body-moon') parents.add(record.parentId)
      increment('sources', record.source); increment('categories', record.category); increment('geometry', record.geometryStatus)
      increment('ephemerides', record.ephemerisStatus); increment('confirmations', record.confirmation); increment('identities', record.identityStatus)
      if (record.ephemerisStatus === 'state-available-at-audit-epoch') {
        const evidence = record.kernelEvidence
        if (record.confirmation !== 'confirmed' || !evidence?.segments?.length || evidence.auditEt !== manifest.kernels.auditEt || evidence.target !== record.naifId) throw new Error('Invalid ephemeris coverage claim')
        for (const part of ['position', 'velocity']) for (const axis of ['x', 'y', 'z']) if (!Number.isFinite(evidence.stateAtAuditEpoch?.[part]?.[axis])) throw new Error('Nonfinite kernel state')
      }
      if (record.identityStatus === 'unresolved-component' && !record.id.includes(':record:')) throw new Error('Unresolved component masquerades as resolved identity')
      // A synchronous observer can build bounded secondary indexes in this same
      // verified pass. It must not publish results until full validation returns.
      if (onRecord) {
        const result = onRecord(record, total - 1)
        if (result?.then) throw new Error('Inventory observer must be synchronous')
      }
      }
      rowStart += block.count
      offset += block.bytes
      uncompressedBytes += block.uncompressedBytes
    }
    if (rowStart !== shard.count || offset !== bytes.length || (shard.uncompressedBytes !== undefined && uncompressedBytes !== shard.uncompressedBytes)) throw new Error(`Shard block coverage mismatch: ${shard.file}`)
  }
  if (total !== manifest.totalRecords) throw new Error('Inventory total mismatch')
  const ordered = (object) => JSON.stringify(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
  for (const group of Object.keys(counts)) if (ordered(counts[group]) !== ordered(manifest.counts?.[group] ?? {})) throw new Error(`Inventory count mismatch: ${group}`)
  for (const [source, expected] of Object.entries(manifest.expectedCounts)) if (counts.sources[source] !== expected) throw new Error(`Unaccounted source rows: ${source}`)
  const missingParents = [...parents].filter((id) => !ids.has(id)).sort()
  if (JSON.stringify(missingParents) !== JSON.stringify(manifest.missingParents)) throw new Error('Missing-parent ledger mismatch')
  return { recordsVerified: total, shardsVerified: files.size, counts, missingParents,
    manifestSha256: digest(manifestBytes), snapshotSha256: manifest.snapshot ? digest(JSON.stringify(manifest.snapshot)) : null }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node scripts/validate-body-inventory.mjs INVENTORY_DIR [SOURCE_DIR]')
  console.log(JSON.stringify(await validateInventory(resolve(process.argv[2]), process.argv[3] ? resolve(process.argv[3]) : undefined), null, 2))
}
