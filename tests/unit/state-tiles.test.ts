import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { assembleStateTiles, chunkStatePlanIds, StateTileSnapshot, decodeStateTile, digestStateTileRequestIds, encodeStateTile, fetchStateTiles, STATE_TILE_HEADER_BYTES, STATE_TILE_MAGIC, validateStateTileManifest, validateStateTilePlan } from '../../src/lib/stateTiles'
import { createStateTileAdmissionPool, createWorkerTileAdmission, serveStateTileAdmission } from '../../src/lib/stateTileAdmission'

const catalogManifestSha256 = 'a'.repeat(64)
const planHash = 'b'.repeat(64)
const manifest = validateStateTileManifest({ apiVersion: 'solar.api/v1', catalogVersion: 'fixture-v1', catalogManifestSha256 })
const requestIdsSha256 = '125ce75f8a92d89605241d23e91b7da781560c79a07d06773b180563b11ae5d9'
const plan = validateStateTilePlan({ apiVersion: 'solar.api/v1', planId: planHash, requestIdsSha256, catalogVersion: 'fixture-v1', catalogManifestSha256, epochJd: 2461287.5, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s', fieldMask: ['position', 'velocity'], stride: 6, tileCount: 2, bodyCount: 2, exactCount: 2, approximateCount: 0, missingCount: 0, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: 1 }, { sequence: 1, ordinalStart: 1, ordinalCount: 1 }] }, manifest, 2461287.5, ['earth', 'mars'], requestIdsSha256)
const metadata = (id: string) => ({ id, availability: 'operational', precision: 'exact', source: 'fixture', datasetVersion: 'v1', datasetSha256: catalogManifestSha256, kernelSha256: 'c'.repeat(64), model: 'spk-original', centerId: 'naif:0', validityStartEt: -1e12, validityEndEt: 1e12, validityPresent: true, stateEvidence: 'kernel', evidenceWindowStartEt: -1e12, evidenceWindowEndEt: 1e12, evidenceWindowPresent: false, missingReason: '', identityStatus: '', sourceRecord: false })

async function tile(sequence: number, id: string, value: number) { return encodeStateTile({ sequence, tileCount: 2, ordinalStart: sequence, epochJd: 2461287.5, metadata: [metadata(id)], states: new Float64Array([value, value + 1, value + 2, 0, 0, 0]), planHash, catalogManifestSha256 }) }
async function refreshPayloadChecksum(buffer: ArrayBuffer) { const bytes = new Uint8Array(buffer); const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(STATE_TILE_HEADER_BYTES))); bytes.set(sum, 168); return bytes.buffer }
async function replaceMetadata(buffer: ArrayBuffer, text: string) {
  const original = new Uint8Array(buffer), old = new DataView(buffer)
  const metadata = new TextEncoder().encode(text), bitmapLength = old.getUint32(52, true)
  const exact = STATE_TILE_HEADER_BYTES + metadata.length, approximate = exact + bitmapLength, missing = approximate + bitmapLength
  const statesOffset = Math.ceil((missing + bitmapLength) / 8) * 8
  const result = new Uint8Array(statesOffset + old.getUint32(68, true)), view = new DataView(result.buffer)
  result.set(original.subarray(0, STATE_TILE_HEADER_BYTES))
  result.set(metadata, STATE_TILE_HEADER_BYTES)
  result.set(original.subarray(old.getUint32(48, true), old.getUint32(60, true) + bitmapLength), exact)
  result.set(original.subarray(old.getUint32(64, true)), statesOffset)
  for (const [offset, value] of [[44, metadata.length], [48, exact], [56, approximate], [60, missing], [64, statesOffset]]) view.setUint32(offset, value, true)
  return refreshPayloadChecksum(result.buffer)
}
function response(buffer: ArrayBuffer, ok = true, extraHeaders: Record<string, string> = {}): Response { const bytes = new Uint8Array(buffer); const payloadHash = [...bytes.slice(168, 200)].map(value => value.toString(16).padStart(2, '0')).join(''); return { ok, status: ok ? 200 : 503, headers: new Headers({ 'content-type': 'application/vnd.solar.state-tile+binary', 'content-length': String(bytes.byteLength), etag: `"${payloadHash}"`, ...extraHeaders }), arrayBuffer: async () => buffer } as Response }

describe('state tile binary protocol', () => {
  it.each(['status', 'type', 'length'])('holds admission until an unread %s failure body is canceled', async invalid => {
    const pool = createStateTileAdmissionPool(1)
    let finishCancellation!: () => void
    const cancel = vi.fn(() => new Promise<void>(resolve => { finishCancellation = resolve }))
    const streamed = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: invalid === 'status' ? 400 : 200,
      headers: { 'content-type': invalid === 'type' ? 'text/plain' : 'application/vnd.solar.state-tile+binary',
        'content-length': invalid === 'length' ? '-1' : '1024' },
    })
    const fetcher = vi.fn(async () => streamed)
    const pending = fetchStateTiles({ base: 'https://fixture.invalid', plan: { ...plan, tiles: [plan.tiles[0]], tileCount: 1, recordCount: 1 },
      signal: new AbortController().signal, fetcher, acquireTile: pool.acquire })
    const rejected = expect(pending).rejects.toThrow(/HTTP 400|content type|content length/)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    const next = pool.acquire(new AbortController().signal)
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 1, admitted: 1 })
    finishCancellation(); await rejected
    const release = await next; release()
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0, admitted: 2 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('holds a shared cross-worker permit through complete body read and decode instead of doubling the per-plan limit', async () => {
    const tiles = [await tile(0, 'earth', 1), await tile(1, 'mars', 4)]
    async function run(shared: boolean) {
      const pool = createStateTileAdmissionPool(), channels = [new MessageChannel(), new MessageChannel()]
      const detach = channels.map(channel => serveStateTileAdmission(channel.port1, pool))
      const workers = channels.map(channel => createWorkerTileAdmission(channel.port2))
      let active = 0, peak = 0, completed = 0
      const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const sequence = JSON.parse(String(init?.body)).sequence as number
        active++; peak = Math.max(peak, active)
        // Receiving headers does not mean the transfer has completed.
        const received = response(tiles[sequence])
        received.arrayBuffer = async () => {
          await new Promise(resolve => setTimeout(resolve, 5))
          active--; completed++
          return tiles[sequence].slice(0)
        }
        return received
      })
      try {
        const results = await Promise.all(workers.map(worker => fetchStateTiles({ base: 'https://fixture.invalid', plan,
          signal: new AbortController().signal, fetcher, acquireTile: shared ? worker.acquire : undefined })))
        expect(results.map(rows => rows.map(row => row.metadata.idAt(0)))).toEqual([['earth', 'mars'], ['earth', 'mars']])
        expect(completed).toBe(4)
        if (shared) await vi.waitFor(() => expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0, admitted: 4 }))
        return peak
      } finally { workers.forEach(worker => worker.dispose()); detach.forEach(close => close()) }
    }
    expect(await run(false)).toBe(4) // Reproduces the old pair of independent two-tile limits.
    expect(await run(true)).toBe(2)
  })

  it('retains a maximum synthetic tile as columns and interns repeated provenance without materializing ID reads', async () => {
    const count = 32_768
    const records = Array.from({ length: count }, (_, index) => metadata(`synthetic:${index}`))
    const states = new Float64Array(count * 6)
    for (let index = 0; index < states.length; index++) states[index] = index % 2 ? -index / 7 : index / 11
    states[0] = -0
    const buffer = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: plan.epochJd,
      metadata: records, states, planHash, catalogManifestSha256 })
    const decoded = await decodeStateTile(buffer, { planHash, catalogManifestSha256 })
    expect(Array.isArray(decoded.metadata)).toBe(false)
    expect(decoded.metadata.length).toBe(count)
    expect(decoded.metadata.numericByteLength).toBe(count * (10 * 4 + 4 * 8 + 1))
    expect(decoded.metadata.internedStringCount).toBe(count + 8)
    const readRow = vi.spyOn(decoded.metadata, 'rowAt')
    // Check every ordinal, without constructing tens of thousands of matcher
    // objects or deep-comparing a 1.5 MiB typed array as JavaScript properties.
    const mismatchedId = records.findIndex((record, index) => decoded.metadata.idAt(index) !== record.id)
    expect(mismatchedId, 'First mismatched original ID ordinal').toBe(-1)
    expect(readRow).not.toHaveBeenCalled()
    const page = Array.from({ length: 20 }, (_, index) => decoded.metadata.rowAt(100 + index))
    expect(readRow).toHaveBeenCalledTimes(20)
    expect(page.map(row => row.id)).toEqual(records.slice(100, 120).map(row => row.id))
    readRow.mockRestore()
    const actualBytes = Buffer.from(decoded.states.buffer, decoded.states.byteOffset, decoded.states.byteLength)
    const expectedBytes = Buffer.from(states.buffer, states.byteOffset, states.byteLength)
    expect(actualBytes.equals(expectedBytes), 'Every Float64 state byte, including signed zero').toBe(true)
    // Prove comparison sensitivity at the last byte; no sampling or rounding.
    actualBytes[actualBytes.length - 1] ^= 1
    expect(actualBytes.equals(expectedBytes)).toBe(false)
    actualBytes[actualBytes.length - 1] ^= 1
    // Input bytes and materialized evidence are not retained mutable aliases.
    new Uint8Array(buffer).fill(0)
    records[100].source = 'mutated input'
    page[0].source = 'mutated row'
    expect(decoded.metadata.rowAt(100).source).toBe('fixture')
    expect(decoded.metadata.idAt(count - 1)).toBe(`synthetic:${count - 1}`)
  })

  it('preserves every evidence flag, window, original Unicode ID and rejects invalid accessor ordinals', async () => {
    const rows = Array.from({ length: 8 }, (_, flags) => ({ ...metadata(`来源:彗星:${flags}`),
      validityPresent: Boolean(flags & 1), evidenceWindowPresent: Boolean(flags & 2), sourceRecord: Boolean(flags & 4),
      validityStartEt: -0, validityEndEt: 1e12, evidenceWindowStartEt: -1e12, evidenceWindowEndEt: 0.125,
      missingReason: 'unresolved-source-identity', identityStatus: 'unmapped', backendId: 'must-not-rename' }))
    const buffer = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: plan.epochJd,
      metadata: rows, exact: [], states: new Float64Array(48), planHash, catalogManifestSha256 })
    const decoded = await decodeStateTile(buffer, { planHash, catalogManifestSha256 })
    for (let index = 0; index < rows.length; index++) {
      const expected = Object.fromEntries(Object.entries(rows[index]).filter(([key]) => !['availability', 'precision', 'backendId'].includes(key)))
      const actual = decoded.metadata.rowAt(index)
      expect(actual).toEqual({ ...expected, validityStartEt: 0 })
      expect(Object.is(actual.validityStartEt, -0)).toBe(false) // JSON encodes -0 as 0.
      expect(actual).not.toHaveProperty('backendId')
      expect(actual).not.toHaveProperty('availability')
      expect(actual).not.toHaveProperty('precision')
    }
    for (const ordinal of [-1, 8, 1.5, NaN, Infinity]) {
      expect(() => decoded.metadata.idAt(ordinal)).toThrow(RangeError)
      expect(() => decoded.metadata.rowAt(ordinal)).toThrow(RangeError)
    }
  })

  it('rejects assembled exact/missing totals that disagree with the validated plan', async () => {
    const mixedPlan = validateStateTilePlan({ ...plan, precision: 'exact', distanceUnit: 'km', velocityUnit: 'km/s',
      fieldMask: ['position', 'velocity'], bodyCount: 2, exactCount: 1, approximateCount: 0, missingCount: 1,
      tiles: plan.tiles.map(item => ({ ...item, ordinalCount: item.recordCount })) }, manifest, plan.epochJd, plan.requestIds, requestIdsSha256)
    const earth = await decodeStateTile(await tile(0, 'earth', 1), { planHash, catalogManifestSha256 })
    const mars = await decodeStateTile(await tile(1, 'mars', 4), { planHash, catalogManifestSha256 })
    expect(() => assembleStateTiles([mars, earth], mixedPlan)).toThrow(/precision count mismatch/i)
    const missing = await decodeStateTile(await encodeStateTile({ sequence: 1, tileCount: 2, ordinalStart: 1,
      epochJd: plan.epochJd, metadata: [{ ...metadata('mars'), missingReason: 'kernel-coverage-gap' }],
      exact: [], states: new Float64Array(6), planHash, catalogManifestSha256 }), { planHash, catalogManifestSha256 })
    expect(assembleStateTiles([missing, earth, earth], mixedPlan)).toEqual([earth, missing])
    expect(() => assembleStateTiles([missing, earth], plan)).toThrow(/precision count mismatch/i)
  })

  it('requires the plan inventory identity to equal the manifest, including absence', () => {
    const raw = { ...plan, precision: 'exact', distanceUnit: 'km', velocityUnit: 'km/s', fieldMask: ['position', 'velocity'], bodyCount: 2, exactCount: 2, approximateCount: 0, missingCount: 0, tiles: plan.tiles.map(tile => ({ ...tile, ordinalCount: tile.recordCount })) }
    const check = (value: unknown, source = manifest) => validateStateTilePlan(value, source, plan.epochJd, plan.requestIds, requestIdsSha256)
    expect(() => check(raw)).not.toThrow()
    expect(() => check({ ...raw, inventoryManifestSha256: 'd'.repeat(64) })).toThrow(/inventory identity/i)
    const withInventory = { ...manifest, inventoryManifestSha256: 'd'.repeat(64) }
    expect(() => check(raw, withInventory)).toThrow(/inventory identity/i)
    expect(() => check({ ...raw, inventoryManifestSha256: 'd'.repeat(64) }, withInventory)).not.toThrow()
  })

  it('preserves scientific evidence and binds resolved identity/status to the validated wire fields', async () => {
    const buffer = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: plan.epochJd, metadata: [{ ...metadata('earth'), backendId: 'mars', precision: 'invented', availability: 'invented' }], states: new Float64Array([1, 2, 3, 0, 0, 0]), planHash, catalogManifestSha256 })
    const decoded = await decodeStateTile(buffer, { planHash, catalogManifestSha256 })
    const requested = new Map([['earth', 'earth']])
    const resolved = new StateTileSnapshot([decoded], requested)
    expect(resolved.length).toBe(1)
    expect(resolved.backendIdAt(0)).toBe('earth')
    expect(resolved.rowAt(0)).toMatchObject({ bodyId: 'earth', backendId: 'earth', precision: 'exact', availability: 'operational', datasetSha256: catalogManifestSha256, kernelSha256: 'c'.repeat(64), validityPresent: true, sourceRecord: false, evidenceWindowPresent: false })
    expect(() => new StateTileSnapshot([decoded, decoded], requested)).toThrow(/duplicate.*identity/i)
  })

  it('rejects blank NDJSON rows and stops parsing at the declared row count', async () => {
    const original = await tile(0, 'earth', 1), line = JSON.stringify(metadata('earth')) + '\n'
    await expect(decodeStateTile(await replaceMetadata(original, '\n' + line), { planHash, catalogManifestSha256 })).rejects.toThrow(/metadata/i)
    const extra = await replaceMetadata(original, line.repeat(1001))
    const parser = vi.spyOn(JSON, 'parse')
    try {
      await expect(decodeStateTile(extra, { planHash, catalogManifestSha256 })).rejects.toThrow(/metadata/i)
      expect(parser).toHaveBeenCalledTimes(1)
    } finally { parser.mockRestore() }
  })
  it('partitions oversized selections without dropping IDs and deduplicates stably', () => {
    const ids = Array.from({ length: 32_769 }, (_, index) => `naif:${index + 1}`)
    ids.splice(10, 0, ids[3])
    const chunks = chunkStatePlanIds(ids)
    expect(chunks.map(chunk => chunk.length)).toEqual([32_768, 1])
    expect(chunks.flat()).toEqual(Array.from(new Set(ids)))
  })

  it('binds request IDs with length-prefixed UTF-8 bytes', async () => {
    await expect(digestStateTileRequestIds(['earth', 'mars'])).resolves.toBe(requestIdsSha256)
    await expect(digestStateTileRequestIds(['mars', 'earth'])).resolves.not.toBe(requestIdsSha256)
  })

  it('uses the fixed little-endian 200-byte header and keeps Float64 states', async () => {
    const buffer = await tile(0, 'earth', 1)
    const bytes = new Uint8Array(buffer)
    expect([...bytes.slice(0, 8)]).toEqual([...STATE_TILE_MAGIC])
    expect(bytes.slice(0, 8)).toEqual(Uint8Array.from([0x53, 0x4c, 0x52, 0x54, 0x49, 0x4c, 0x45, 0x00]))
    const view = new DataView(buffer); expect(view.getUint16(8, true)).toBe(1); expect(view.getUint16(10, true)).toBe(STATE_TILE_HEADER_BYTES); expect(view.getUint32(12, true)).toBe(0); expect(view.getUint16(28, true)).toBe(6); expect(view.getUint16(30, true)).toBe(3); expect(view.getFloat64(32, true)).toBe(2461287.5)
    const decoded = await decodeStateTile(buffer, { planHash, catalogManifestSha256, sequence: 0, tileCount: 2 }); expect(decoded.states).toBeInstanceOf(Float64Array); expect([...decoded.states.slice(0, 3)]).toEqual([1, 2, 3]); expect(decoded.metadata.idAt(0)).toBe('earth')
  })

  it('rejects a checksum or bitmap mutation', async () => {
    const buffer = await tile(0, 'earth', 1); const checksum = new Uint8Array(buffer); checksum[checksum.length - 1] ^= 1; await expect(decodeStateTile(checksum, { planHash, catalogManifestSha256 })).rejects.toThrow(/checksum/i)
    const invalid = new Uint8Array(await tile(0, 'earth', 1)); const view = new DataView(invalid.buffer); const bitmapOffset = view.getUint32(48, true); invalid[bitmapOffset] |= 2; await expect(decodeStateTile(invalid, { planHash, catalogManifestSha256 })).rejects.toThrow(/checksum|bitmap/i)
  })

  it('rejects approximate rows and non-zero missing states', async () => {
    const approximate = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [metadata('earth')], exact: [], approximate: [0], states: new Float64Array(6), planHash, catalogManifestSha256 })
    await expect(decodeStateTile(approximate, { planHash, catalogManifestSha256 })).rejects.toThrow(/approximate/i)
    const missing = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [{ ...metadata('unknown'), missingReason: 'unknown-identity' }], exact: [], states: new Float64Array([1, 0, 0, 0, 0, 0]), planHash, catalogManifestSha256 })
    await expect(decodeStateTile(missing, { planHash, catalogManifestSha256 })).rejects.toThrow(/zero/i)
    const badProvenance = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [{ ...metadata('earth'), source: '', stateEvidence: '' }], states: new Float64Array(6), planHash, catalogManifestSha256 })
    await expect(decodeStateTile(badProvenance, { planHash, catalogManifestSha256 })).rejects.toThrow(/provenance/i)
    const badMissingReason = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [{ ...metadata('unknown'), missingReason: ' ' }], exact: [], states: new Float64Array(6), planHash, catalogManifestSha256 })
    await expect(decodeStateTile(badMissingReason, { planHash, catalogManifestSha256 })).rejects.toThrow(/reason/i)
  })

  it('binds exact metadata to catalog or inventory provenance', async () => {
    const inventoryHash = 'd'.repeat(64)
    const sourceSnapshot = { ...metadata('source'), sourceRecord: true, identityStatus: 'source-verified', datasetSha256: inventoryHash, model: 'source-kernel-state-at-audit-epoch' }
    const buffer = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [sourceSnapshot], states: new Float64Array(6), planHash, catalogManifestSha256, inventoryManifestSha256: inventoryHash })
    await expect(decodeStateTile(buffer, { planHash, catalogManifestSha256, inventoryManifestSha256: inventoryHash })).resolves.toBeTruthy()
    const badDataset = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [{ ...sourceSnapshot, datasetSha256: catalogManifestSha256 }], states: new Float64Array(6), planHash, catalogManifestSha256, inventoryManifestSha256: inventoryHash })
    await expect(decodeStateTile(badDataset, { planHash, catalogManifestSha256, inventoryManifestSha256: inventoryHash })).rejects.toThrow(/provenance/i)
    const badSnapshot = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: [{ ...sourceSnapshot, sourceRecord: false, identityStatus: '', datasetSha256: catalogManifestSha256 }], states: new Float64Array(6), planHash, catalogManifestSha256, inventoryManifestSha256: inventoryHash })
    await expect(decodeStateTile(badSnapshot, { planHash, catalogManifestSha256, inventoryManifestSha256: inventoryHash })).rejects.toThrow(/snapshot/i)
  })

  it('rejects nonzero bitmap tail bits and noncanonical offsets', async () => {
    const buffer = await encodeStateTile({ sequence: 0, tileCount: 1, ordinalStart: 0, epochJd: 2461287.5, metadata: Array.from({ length: 9 }, (_, index) => metadata(`body-${index}`)), states: new Float64Array(54), planHash, catalogManifestSha256 })
    const tail = new Uint8Array(buffer); const view = new DataView(tail.buffer); tail[view.getUint32(56, true) + 1] |= 0x80
    await expect(decodeStateTile(await refreshPayloadChecksum(tail.buffer), { planHash, catalogManifestSha256 })).rejects.toThrow(/unused|approximate|bitmap/i)
    const offsets = new Uint8Array(buffer); const offsetView = new DataView(offsets.buffer); offsetView.setUint32(48, offsetView.getUint32(48, true) + 1, true)
    await expect(decodeStateTile(offsets, { planHash, catalogManifestSha256 })).rejects.toThrow(/offset/i)
  })

  it('requires strict manifest identity, units, origin, request IDs, counts, and contiguous ordinals', async () => {
    expect(() => validateStateTileManifest({ catalogVersion: 'fixture-v1', catalogManifestSha256 })).toThrow(/api version/i)
    const base = { apiVersion: 'solar.api/v1', planId: planHash, requestIdsSha256, catalogVersion: 'fixture-v1', catalogManifestSha256, epochJd: 2461287.5, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s', fieldMask: ['position', 'velocity'], stride: 6, tileCount: 2, bodyCount: 2, exactCount: 1, approximateCount: 0, missingCount: 1, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: 1 }, { sequence: 1, ordinalStart: 2, ordinalCount: 1 }] }
    expect(() => validateStateTilePlan({ ...base, approximateCount: 1 }, manifest, 2461287.5, ['earth', 'mars'], requestIdsSha256)).toThrow(/inventory/i)
    expect(() => validateStateTilePlan({ ...base, distanceUnit: 'AU' }, manifest, 2461287.5, ['earth', 'mars'], requestIdsSha256)).toThrow(/numeric/i)
    expect(() => validateStateTilePlan(base, manifest, 2461287.5, ['earth', 'mars'], requestIdsSha256)).toThrow(/continuity/i)
    expect(() => validateStateTilePlan({ ...base, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: 1 }, { sequence: 1, ordinalStart: 1, ordinalCount: 1 }] }, manifest, 2461287.5, ['earth', 'mars'], 'c'.repeat(64))).toThrow(/request identity/i)
    const reversedHash = await digestStateTileRequestIds(['mars', 'earth'])
    expect(() => validateStateTilePlan({ ...base, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: 1 }, { sequence: 1, ordinalStart: 1, ordinalCount: 1 }] }, manifest, 2461287.5, ['mars', 'earth'], reversedHash)).toThrow(/request identity/i)
  })

  it('assembles out of order tiles, is idempotent for duplicates, and rejects conflicts', async () => {
    const first = await decodeStateTile(await tile(0, 'earth', 1), { planHash, catalogManifestSha256 }); const second = await decodeStateTile(await tile(1, 'mars', 4), { planHash, catalogManifestSha256 });
    expect(assembleStateTiles([second, first, first], plan).map(item => item.metadata.idAt(0))).toEqual(['earth', 'mars'])
    const reordered = await decodeStateTile(await tile(0, 'mars', 1), { planHash, catalogManifestSha256 }); expect(() => assembleStateTiles([reordered, second], plan)).toThrow(/ordinal/i)
    const conflicting = await decodeStateTile(await tile(1, 'mars', 8), { planHash, catalogManifestSha256 }); expect(() => assembleStateTiles([first, second, conflicting], plan)).toThrow(/conflicting/i)
  })

  it('retries one failed tile and never exceeds two in flight', async () => {
    let active = 0; let maximum = 0; let attempts = 0; const buffers = [await tile(0, 'earth', 1), await tile(1, 'mars', 4)]
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { active += 1; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active -= 1; const sequence = JSON.parse(String(init?.body)).sequence as number; if (sequence === 1 && attempts++ === 0) return response(buffers[1], false); return response(buffers[sequence]) }) as typeof fetch
    const result = await fetchStateTiles({ base: 'https://fixture', plan, signal: new AbortController().signal, fetcher }); expect(result.map(item => item.metadata.idAt(0))).toEqual(['earth', 'mars']); expect(attempts).toBe(2); expect(maximum).toBeLessThanOrEqual(2)
  })

  it('aborts sibling transfers immediately when a tile fails without aborting the caller', async () => {
    const controller = new AbortController()
    let siblingSignal: AbortSignal | null | undefined
    let siblingAborted = false
    const fetcher = (async (_url, init) => {
      const sequence = JSON.parse(String(init?.body)).sequence
      if (sequence === 0) return new Response(null, { status: 400 })
      siblingSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          siblingAborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }) as typeof fetch
    await expect(fetchStateTiles({ base: 'https://fixture', plan, signal: controller.signal, fetcher })).rejects.toThrow(/HTTP 400/)
    expect(siblingSignal).toBeTruthy()
    expect(siblingAborted).toBe(true)
    expect(controller.signal.aborted).toBe(false)
  })

  it('does not retry protocol, content-type, length, or 4xx failures', async () => {
    const buffer = await tile(0, 'earth', 1)
    for (const [name, makeResponse] of [
      ['etag', () => response(buffer, true, { etag: `"${'0'.repeat(64)}"` })],
      ['media type', () => response(buffer, true, { 'content-type': 'application/octet-stream' })],
      ['content length', () => response(buffer, true, { 'content-length': String(buffer.byteLength + 1) })],
      ['client status', () => ({ ...response(buffer, false), status: 400 } as Response)],
    ] as const) {
      let calls = 0
      await expect(fetchStateTiles({ base: 'https://fixture', plan: { ...plan, tiles: [plan.tiles[0]], tileCount: 1, recordCount: 1 }, signal: new AbortController().signal, fetcher: (async () => { calls += 1; return makeResponse() }) as typeof fetch })).rejects.toThrow()
      expect(calls, name).toBe(1)
    }
  })

  it('cancels in-flight work and rejects manifest/plan identity mismatches', async () => {
    expect(() => validateStateTilePlan({ apiVersion: 'solar.api/v1', planId: planHash, requestIdsSha256, catalogVersion: 'fixture-v1', catalogManifestSha256: 'c'.repeat(64), epochJd: 2461287.5, timeScale: 'TDB', frame: 'ECLIPJ2000', precision: 'exact', stateOriginId: 'naif:0', distanceUnit: 'km', velocityUnit: 'km/s', fieldMask: ['position', 'velocity'], stride: 6, tileCount: 1, bodyCount: 1, exactCount: 1, approximateCount: 0, missingCount: 0, tiles: [{ sequence: 0, ordinalStart: 0, ordinalCount: 1 }] }, manifest, 2461287.5, ['earth'], requestIdsSha256)).toThrow(/identity/i)
    const controller = new AbortController(); const pending = fetchStateTiles({ base: 'https://fixture', plan, signal: controller.signal, fetcher: (async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })) as typeof fetch }); controller.abort(); await expect(pending).rejects.toThrow(/abort/i)
  })

  it('cancels a streaming reader when the declared length is exceeded', async () => {
    const buffer = await tile(0, 'earth', 1)
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(buffer)); }, cancel() { canceled = true } })
    const streamed = new Response(stream, { status: 200, headers: { 'content-type': 'application/vnd.solar.state-tile+binary', 'content-length': String(buffer.byteLength - 1), etag: `"${'0'.repeat(64)}"` } })
    const fetcher = (async () => streamed) as typeof fetch
    await expect(fetchStateTiles({ base: 'https://fixture', plan: { ...plan, tiles: [plan.tiles[0]], tileCount: 1, recordCount: 1 }, signal: new AbortController().signal, fetcher })).rejects.toThrow(/size|length/i)
    expect(canceled).toBe(true)
  })

  it('preserves unknown metadata ids and ordinal order', async () => {
    const unknown = await decodeStateTile(await tile(0, 'unknown:42', 1), { planHash, catalogManifestSha256 }); expect(unknown.metadata.idAt(0)).toBe('unknown:42'); expect(unknown.metadata.length).toBe(1); expect(unknown.ordinalStart).toBe(0)
  })
})
