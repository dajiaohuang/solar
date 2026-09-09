#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createGunzip, gzipSync } from 'node:zlib'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseElementLine } from './lib/jpl-element-inventory.mjs'
import { parsePlanetarySatellites, parseSmallBodySatellites } from './lib/satellite-inventory.mjs'
import { downloadSnapshot, verifySnapshot, SOURCE_FILES, digest } from './lib/inventory-snapshot.mjs'
import { inventoryKernels } from './lib/inventory-kernels.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DWARFS = new Set(['1', '134340', '136108', '136199', '136472'])
const CORE = [[10, 'Sun', 'star'], [199, 'Mercury', 'planet'], [299, 'Venus', 'planet'], [399, 'Earth', 'planet'], [301, 'Moon', 'moon'], [499, 'Mars', 'planet'], [599, 'Jupiter', 'planet'], [699, 'Saturn', 'planet'], [799, 'Uranus', 'planet'], [899, 'Neptune', 'planet']]
const increment = (map, key) => { map[key] = (map[key] ?? 0) + 1 }
export const INVENTORY_SCHEMA_VERSION = 2
export const INVENTORY_BLOCK_ROWS = 128

export async function buildInventory({ sources, output, root = ROOT, auditEt = 841752000, shardSize = 5000 }) {
  if (!Number.isFinite(auditEt) || !Number.isSafeInteger(shardSize) || shardSize < 1 || shardSize > 10000) throw new Error('Invalid audit epoch or shard size')
  const snapshot = await verifySnapshot(sources)
  const metadata = JSON.parse(await readFile(join(sources, SOURCE_FILES.metadata), 'utf8'))
  const expectedCounts = {}
  for (const [key, path] of [['numbered', '/dat/ELEMENTS.NUMBR'], ['unnumbered', '/dat/ELEMENTS.UNNUM'], ['comets', '/dat/ELEMENTS.COMET']]) {
    const matches = metadata.list?.filter((item) => item.url === path)
    const count = Number(matches?.[0]?.count)
    if (matches?.length !== 1 || !Number.isSafeInteger(count) || count < 1) throw new Error(`Invalid metadata count: ${key}`)
    expectedCounts[key] = count
  }
  const planetary = parsePlanetarySatellites(await readFile(join(sources, SOURCE_FILES.planetarySatellites), 'utf8'))
  const satellites = parseSmallBodySatellites(JSON.parse(await readFile(join(sources, SOURCE_FILES.smallBodySatellites), 'utf8')))
  expectedCounts.planetarySatellites = planetary.expected
  expectedCounts.smallBodySatellites = satellites.length
  const kernels = await inventoryKernels(root, auditEt)
  const generatorFiles = []
  for (const path of ['scripts/build-body-inventory.mjs', 'scripts/lib/inventory-snapshot.mjs', 'scripts/lib/jpl-element-inventory.mjs', 'scripts/lib/satellite-inventory.mjs', 'scripts/lib/inventory-kernels.mjs']) {
    generatorFiles.push({ path, sha256: digest(await readFile(join(ROOT, path))) })
  }
  await mkdir(output)
  const seen = new Set(), counts = { sources: {}, categories: {}, geometry: {}, ephemerides: {}, confirmations: {}, identities: {} }, shards = []
  const parents = new Set([...planetary.records, ...satellites].map((r) => r.parentId))
  let pending = [], totalRecords = 0
  async function flush() {
    if (!pending.length) return
    const file = `records-${String(shards.length).padStart(5, '0')}.jsonl.bgz`
    const blocks = []
    for (let rowStart = 0; rowStart < pending.length; rowStart += INVENTORY_BLOCK_ROWS) {
      const rows = pending.slice(rowStart, rowStart + INVENTORY_BLOCK_ROWS)
      const uncompressed = Buffer.from(rows.join('\n') + '\n')
      const compressed = gzipSync(uncompressed, { mtime: 0 })
      blocks.push({ rowStart, count: rows.length, offset: blocks.reduce((sum, block) => sum + block.bytes, 0), bytes: compressed.length, payload: compressed, uncompressedBytes: uncompressed.length, sha256: digest(compressed) })
    }
    const bytes = Buffer.concat(blocks.map(block => block.payload))
    await writeFile(join(output, file), bytes, { flag: 'wx' })
    shards.push({ file, count: pending.length, bytes: bytes.length, sha256: digest(bytes), blocks: blocks.map(({ payload: _payload, ...block }) => block) })
    pending = []
  }
  async function append(record, source, sourceRow) {
    if (expectedCounts[source] !== undefined && (counts.sources[source] ?? 0) >= expectedCounts[source]) throw new Error(`Source exceeds declared count: ${source}`)
    if (!record.id || seen.has(record.id)) throw new Error(`Duplicate inventory identity: ${record.id}`)
    seen.add(record.id)
    if (record.category === 'asteroid' && DWARFS.has(record.designation)) record = { ...record, category: 'dwarf-planet' }
    record = kernels.attach({ ...record, identityStatus: record.identityStatus ?? 'source-designation', source, sourceRow })
    increment(counts.sources, source); increment(counts.categories, record.category)
    increment(counts.geometry, record.geometryStatus); increment(counts.ephemerides, record.ephemerisStatus)
    increment(counts.confirmations, record.confirmation); increment(counts.identities, record.identityStatus)
    pending.push(JSON.stringify(record)); totalRecords++
    if (pending.length >= shardSize) await flush()
  }
  for (const [key, kind] of [['numbered', 'numbered-asteroid'], ['unnumbered', 'unnumbered-asteroid'], ['comets', 'comet']]) {
    const raw = createReadStream(join(sources, SOURCE_FILES[key]))
    const stream = key === 'comets' ? raw : raw.pipe(createGunzip())
    raw.on('error', (error) => stream.destroy(error))
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    let lineNumber = 0
    try {
      for await (const line of lines) {
        lineNumber++
        if (line.length > 4096) throw new Error(`Unexpected source line length: ${key}:${lineNumber}`)
        const record = parseElementLine(line, kind)
        if (record) await append(record, key, lineNumber)
      }
    } finally { lines.close(); stream.destroy(); raw.destroy() }
    if (counts.sources[key] !== expectedCounts[key]) throw new Error(`Source count mismatch for ${key}: ${counts.sources[key]} != ${expectedCounts[key]}`)
  }
  for (const [target, name, category] of CORE) await append({ id: `naif:${target}`, designation: name, name, category,
    parentId: target === 10 ? null : target === 301 ? 'naif:399' : 'naif:10', confirmation: 'confirmed',
    geometryStatus: 'kernel-dependent', sourceRef: 'Bundled NAIF body-center identity' }, 'majorCenters', target)
  // Pluto may be absent from the small-body element table. Keep one identity if
  // it is present, and retain the body center if the source excludes it.
  if (!seen.has('sb:asteroid:134340')) await append({ id: 'sb:asteroid:134340', designation: '134340', name: 'Pluto', category: 'dwarf-planet', parentId: 'naif:10', confirmation: 'confirmed', geometryStatus: 'kernel-dependent', sourceRef: 'Pluto body center in bundled NAIF kernel' }, 'majorCenters', 999)
  for (const [index, record] of planetary.records.entries()) await append(record, 'planetarySatellites', index)
  for (const record of satellites) await append(record, 'smallBodySatellites', record.sourceRow)
  await flush()
  const missingParents = [...parents].filter((id) => !seen.has(id)).sort()
  const manifest = { schemaVersion: INVENTORY_SCHEMA_VERSION, format: 'jsonl-deterministic-gzip-blocks-v2', blockRows: INVENTORY_BLOCK_ROWS, purpose: 'source-inventory-addressable-v2',
    snapshot, generator: { id: 'body-inventory-v2', files: generatorFiles }, elementTableUpdated: metadata.updated, totalRecords, counts, expectedCounts, shards, kernels: kernels.evidence,
    missingParents, planetaryGroups: planetary.groups,
    gaps: ['Unresolved component records are snapshot-row identities, not unique-body assertions.',
      'Cross-source asteroid/comet aliases and component aliases still require reconciliation; counts are source records, not an all-known-body union.',
      'Metadata-only, raw satellite elements and open conics are not yet runtime-selectable or verified ephemerides.',
      'Coverage of undiscovered objects or all physical effects is not claimed.'],
  }
  // Publish the completion marker last; failure leaves no successful manifest.
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('node --experimental-strip-types scripts/build-body-inventory.mjs [--download] --sources NEW_SNAPSHOT_DIR --output NEW_INVENTORY_DIR [--audit-et TDB_SECONDS]')
  } else {
    const values = new Map()
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--download') { values.set(args[i], true); continue }
      if (!['--sources', '--output', '--audit-et'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown or incomplete argument; use --help')
      if (values.has(args[i])) throw new Error('Duplicate argument')
      values.set(args[i], args[++i])
    }
    if (!values.get('--sources') || !values.get('--output')) throw new Error('--sources and --output are required')
    const sources = resolve(values.get('--sources')), output = resolve(values.get('--output'))
    if (sources === output) throw new Error('Source and output directories must differ')
    if (values.get('--download')) await downloadSnapshot(sources)
    const result = await buildInventory({ sources, output, auditEt: values.has('--audit-et') ? Number(values.get('--audit-et')) : undefined })
    console.log(JSON.stringify({ output, totalRecords: result.totalRecords, counts: result.counts, missingParents: result.missingParents }, null, 2))
  }
}
