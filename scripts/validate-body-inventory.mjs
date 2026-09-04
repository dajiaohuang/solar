#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digest, verifySnapshot } from './lib/inventory-snapshot.mjs'

export async function validateInventory(directory, sourceDirectory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.purpose !== 'source-inventory-not-runtime-catalog' || !Array.isArray(manifest.shards) || !manifest.shards.length) throw new Error('Invalid inventory manifest')
  if (sourceDirectory) {
    const actual = await verifySnapshot(sourceDirectory)
    if (JSON.stringify(actual) !== JSON.stringify(manifest.snapshot)) throw new Error('Inventory does not match source snapshot')
  }
  const ids = new Set(), counts = { sources: {}, categories: {}, geometry: {}, ephemerides: {}, confirmations: {}, identities: {} }, parents = new Set()
  const increment = (group, value) => { if (typeof value !== 'string' || !value) throw new Error(`Missing ${group}`); counts[group][value] = (counts[group][value] ?? 0) + 1 }
  let total = 0
  const files = new Set()
  for (const shard of manifest.shards) {
    if (!/^records-\d{5}\.jsonl\.gz$/.test(shard.file) || files.has(shard.file)) throw new Error('Invalid or duplicate shard path')
    files.add(shard.file)
    const bytes = await readFile(join(directory, shard.file))
    if (bytes.length !== shard.bytes || digest(bytes) !== shard.sha256) throw new Error(`Shard integrity mismatch: ${shard.file}`)
    const decoded = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')
    if (!decoded.endsWith('\n')) throw new Error('Unterminated inventory shard')
    const lines = decoded.slice(0, -1).split('\n')
    if (lines.length !== shard.count || lines.length > 10000) throw new Error('Shard count mismatch')
    for (const line of lines) {
      const record = JSON.parse(line)
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
    }
  }
  if (total !== manifest.totalRecords) throw new Error('Inventory total mismatch')
  const ordered = (object) => JSON.stringify(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
  for (const group of Object.keys(counts)) if (ordered(counts[group]) !== ordered(manifest.counts?.[group] ?? {})) throw new Error(`Inventory count mismatch: ${group}`)
  for (const [source, expected] of Object.entries(manifest.expectedCounts)) if (counts.sources[source] !== expected) throw new Error(`Unaccounted source rows: ${source}`)
  const missingParents = [...parents].filter((id) => !ids.has(id)).sort()
  if (JSON.stringify(missingParents) !== JSON.stringify(manifest.missingParents)) throw new Error('Missing-parent ledger mismatch')
  return { recordsVerified: total, shardsVerified: files.size, counts, missingParents }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node scripts/validate-body-inventory.mjs INVENTORY_DIR [SOURCE_DIR]')
  console.log(JSON.stringify(await validateInventory(resolve(process.argv[2]), process.argv[3] ? resolve(process.argv[3]) : undefined), null, 2))
}
