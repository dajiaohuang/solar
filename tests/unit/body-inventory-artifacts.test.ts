import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { downloadSnapshot, verifySnapshot, SOURCE_FILES, digest } from '../../scripts/lib/inventory-snapshot.mjs'
import { validateInventory } from '../../scripts/validate-body-inventory.mjs'

const directories: string[] = []
async function temporary() { const dir = await mkdtemp(join(tmpdir(), 'solar-inventory-test-')); directories.push(dir); return dir }
afterEach(async () => { vi.unstubAllGlobals(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

describe('inventory snapshots and fail-closed artifacts', () => {
  it('fetches serially, pins bytes, verifies offline and refuses overwrite', async () => {
    const directory = join(await temporary(), 'sources')
    const calls: Array<[string, string]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: { method: string }) => {
      calls.push([url, options.method])
      return new Response(options.method === 'HEAD' ? null : 'fixture source', { headers: { etag: 'fixture-v1', 'last-modified': 'Thu, 03 Sep 2026 09:33:03 GMT' } })
    }))
    const snapshot = await downloadSnapshot(directory)
    expect(await verifySnapshot(directory)).toEqual(snapshot)
    expect(calls.slice(0, 6).every(([, method]) => method === 'GET')).toBe(true)
    expect(calls.slice(-4).every(([, method]) => method === 'HEAD')).toBe(true)
    await expect(downloadSnapshot(directory)).rejects.toThrow()
    await writeFile(join(directory, SOURCE_FILES.comets), 'tampered')
    await expect(verifySnapshot(directory)).rejects.toThrow('integrity mismatch')
  })
  it('never writes a completion manifest across a source refresh', async () => {
    const directory = join(await temporary(), 'sources')
    let metadataReads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('elem_files.json') ? String(metadataReads++) : 'fixture', { headers: { etag: 'v1' } })))
    await expect(downloadSnapshot(directory)).rejects.toThrow('changed during download')
    await expect(readFile(join(directory, 'snapshot.json'))).rejects.toThrow()
  })
  it('stops on an upstream failure without publishing success', async () => {
    const directory = join(await temporary(), 'sources')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 429 })))
    await expect(downloadSnapshot(directory)).rejects.toThrow('HTTP 429')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    await expect(readFile(join(directory, 'snapshot.json'))).rejects.toThrow()
  })
  it('independently recounts records and rejects corrupt shards and unsafe paths', async () => {
    const directory = join(await temporary(), 'inventory'); await mkdir(directory)
    const record = { id: 'sb:comet:fixture', category: 'comet', source: 'comets', confirmation: 'confirmed', identityStatus: 'source-designation', geometryStatus: 'open-conic-elements', ephemerisStatus: 'not-mapped-to-bundled-kernel' }
    const uncompressed = Buffer.from(JSON.stringify(record) + '\n')
    const bytes = gzipSync(uncompressed, { mtime: 0 })
    const file = 'records-00000.jsonl.bgz'
    const block = { rowStart: 0, count: 1, offset: 0, bytes: bytes.length, uncompressedBytes: uncompressed.length, sha256: digest(bytes) }
    const manifest = { schemaVersion: 2, format: 'jsonl-deterministic-gzip-blocks-v2', blockRows: 128, purpose: 'source-inventory-addressable-v2', totalRecords: 1,
      counts: { sources: { comets: 1 }, categories: { comet: 1 }, confirmations: { confirmed: 1 }, identities: { 'source-designation': 1 }, geometry: { 'open-conic-elements': 1 }, ephemerides: { 'not-mapped-to-bundled-kernel': 1 } },
      expectedCounts: { comets: 1 }, shards: [{ file, count: 1, bytes: bytes.length, sha256: digest(bytes), blocks: [block] }], missingParents: [] }
    await writeFile(join(directory, file), bytes)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    expect((await validateInventory(directory)).recordsVerified).toBe(1)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, totalRecords: 2 }))
    await expect(validateInventory(directory)).rejects.toThrow('total mismatch')
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, shards: [{ ...manifest.shards[0], file: '../escape.gz' }] }))
    await expect(validateInventory(directory)).rejects.toThrow('shard path')
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(directory, file), 'corruption')
    await expect(validateInventory(directory)).rejects.toThrow('integrity mismatch')
  })
  it('rejects non-contiguous block coverage and legacy manifests', async () => {
    const directory = join(await temporary(), 'inventory'); await mkdir(directory)
    const record = { id: 'sb:comet:fixture', category: 'comet', source: 'comets', confirmation: 'confirmed', identityStatus: 'source-designation', geometryStatus: 'open-conic-elements', ephemerisStatus: 'not-mapped-to-bundled-kernel' }
    const uncompressed = Buffer.from(JSON.stringify(record) + '\n')
    const bytes = gzipSync(uncompressed, { mtime: 0 })
    const file = 'records-00000.jsonl.bgz'
    const block = { rowStart: 0, count: 1, offset: 0, bytes: bytes.length, uncompressedBytes: uncompressed.length, sha256: digest(bytes) }
    const manifest = { schemaVersion: 2, format: 'jsonl-deterministic-gzip-blocks-v2', blockRows: 128, purpose: 'source-inventory-addressable-v2', totalRecords: 1,
      counts: { sources: { comets: 1 }, categories: { comet: 1 }, confirmations: { confirmed: 1 }, identities: { 'source-designation': 1 }, geometry: { 'open-conic-elements': 1 }, ephemerides: { 'not-mapped-to-bundled-kernel': 1 } },
      expectedCounts: { comets: 1 }, shards: [{ file, count: 1, bytes: bytes.length, sha256: digest(bytes), blocks: [block] }], missingParents: [] }
    await writeFile(join(directory, file), bytes)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, schemaVersion: 1 }))
    await expect(validateInventory(directory)).rejects.toThrow('Invalid inventory manifest')
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, shards: [{ ...manifest.shards[0], blocks: [{ ...block, offset: 1 }] }] }))
    await expect(validateInventory(directory)).rejects.toThrow('block metadata')
  })
  it('validates independently compressed members and their complete-file digest', async () => {
    const directory = join(await temporary(), 'inventory'); await mkdir(directory)
    const records = ['a', 'b'].map((id) => ({ id: `sb:comet:${id}`, category: 'comet', source: 'comets', confirmation: 'confirmed', identityStatus: 'source-designation', geometryStatus: 'open-conic-elements', ephemerisStatus: 'not-mapped-to-bundled-kernel' }))
    const payloads = records.map((record) => gzipSync(Buffer.from(JSON.stringify(record) + '\n'), { mtime: 0 }))
    const bytes = Buffer.concat(payloads)
    const blocks = payloads.map((payload, rowStart) => ({ rowStart, count: 1, offset: payloads.slice(0, rowStart).reduce((sum, value) => sum + value.length, 0), bytes: payload.length, uncompressedBytes: Buffer.byteLength(JSON.stringify(records[rowStart]) + '\n'), sha256: digest(payload) }))
    const file = 'records-00000.jsonl.bgz'
    const manifest = { schemaVersion: 2, format: 'jsonl-deterministic-gzip-blocks-v2', blockRows: 128, purpose: 'source-inventory-addressable-v2', totalRecords: 2,
      counts: { sources: { comets: 2 }, categories: { comet: 2 }, confirmations: { confirmed: 2 }, identities: { 'source-designation': 2 }, geometry: { 'open-conic-elements': 2 }, ephemerides: { 'not-mapped-to-bundled-kernel': 2 } },
      expectedCounts: { comets: 2 }, shards: [{ file, count: 2, bytes: bytes.length, sha256: digest(bytes), blocks }], missingParents: [] }
    await writeFile(join(directory, file), bytes)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    expect((await validateInventory(directory)).recordsVerified).toBe(2)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, shards: [{ ...manifest.shards[0], blocks: [blocks[0], { ...blocks[1], sha256: '0'.repeat(64) }] }] }))
    await expect(validateInventory(directory)).rejects.toThrow(/integrity mismatch/i)
  })
})
