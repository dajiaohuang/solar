import { readFile } from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { decodeGaiaManifest, gaiaHash, selectGaiaChunks, streamGaiaChunks, type GaiaChunk, type GaiaSkyRegion } from '../../src/lib/gaiaChunks'

const root = 'tests/fixtures/gaia-pleiades-20260923/'
const manifest = decodeGaiaManifest(await readFile(root+'manifest.json'))
const raw = await readFile(root+manifest.chunks[0].path)
const region: GaiaSkyRegion = { raStartDeg: 0, raEndDeg: 360, decMinDeg: -90, decMaxDeg: 90, epochJulianYear: 2016 }
const response = (bytes: Uint8Array) => new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength) } })
test('real Gaia capture loads verified source IDs and unit directions at the catalog epoch', async () => {
  const chunks: GaiaChunk[] = []
  const summary = await streamGaiaChunks({ manifest, region, baseUrl: 'https://example.test/gaia/', signal: new AbortController().signal, fetcher: vi.fn(async () => response(raw)), onChunk: async c => { chunks.push(c) } })
  expect(summary.verifiedRows).toBe(19); expect(summary.peakReservedBytes).toBe(raw.length)
  expect(chunks[0].sources[0].source_id).toBe('65212004581252736')
  const v = chunks[0].directionsICRS
  expect(v).toBeInstanceOf(Float64Array)
  expect(Math.hypot(v[0],v[1],v[2])).toBeCloseTo(1, 14)
  expect(Math.atan2(v[1],v[0])*180/Math.PI).toBeCloseTo(chunks[0].sources[0].ra, 13)
  expect(Math.asin(v[2])*180/Math.PI).toBeCloseTo(chunks[0].sources[0].dec, 13)
})
test('rejects modified hashes and epoch/budget violations before publishing', async () => {
  const publish = vi.fn(async () => {}), fetcher = vi.fn(async () => response(raw))
  const options = { manifest, region, baseUrl: 'https://example.test/gaia/', signal: new AbortController().signal, fetcher, onChunk: publish }
  await expect(streamGaiaChunks({ ...options, maxInFlightRows: 18 })).rejects.toThrow(/budget/)
  expect(fetcher).not.toHaveBeenCalled()
  expect(() => selectGaiaChunks(manifest, { ...region, epochJulianYear: 2026 } as unknown as GaiaSkyRegion)).toThrow(/J2016/)
  const corrupt = Uint8Array.from(raw); corrupt[corrupt.length-2] ^= 1
  await expect(streamGaiaChunks({ ...options, fetcher: vi.fn(async () => response(corrupt)) })).rejects.toThrow(/hash/)
  expect(publish).not.toHaveBeenCalled()
  const bad = structuredClone(manifest); bad.chunks[0].path = '../outside.json'
  await expect(streamGaiaChunks({ ...options, manifest: bad })).rejects.toThrow(/descriptor/)
})
async function syntheticPartition() {
  // Synthetic queue/budget geometry only; never a scientific or capacity oracle.
  const source = JSON.parse(raw.toString()).sources[0], files = new Map<string, Uint8Array>()
  const descriptors = []
  for (const r of [0,1,71]) {
    const path = `r${r}-d18.json`, raRangeDeg: [number,number] = [r*5,(r+1)*5], decRangeDeg: [number,number] = [0,5]
    const bytes = new TextEncoder().encode(JSON.stringify({ key: path.slice(0,-5), raRangeDeg, decRangeDeg, sources: [{ ...source, source_id: String(100+r), ra: r*5+1, dec: 1 }] }))
    files.set(path, bytes); descriptors.push({ path, raRangeDeg, decRangeDeg, bytes: bytes.length, rows: 1, sha256: await gaiaHash(bytes) })
  }
  return { files, manifest: { ...manifest, rows: 3, chunks: descriptors } }
}
test('wrap-aware filtering selects only intersecting bins', async () => {
  const { manifest: m } = await syntheticPartition()
  expect(selectGaiaChunks(m, { ...region, raStartDeg: 358, raEndDeg: 2 }).map(c => c.path)).toEqual(['r0-d18.json','r71-d18.json'])
  expect(selectGaiaChunks(m, { ...region, decMinDeg: 30, decMaxDeg: 40 })).toEqual([])
  expect(selectGaiaChunks(m, { ...region, raStartDeg: 0, raEndDeg: 0 }).map(c => c.path)).toEqual(['r0-d18.json','r71-d18.json'])
  const polar = { ...m, chunks: m.chunks.map(c => ({ ...c, decRangeDeg: [85,90] as [number,number] })) }
  expect(selectGaiaChunks(polar, { ...region, raStartDeg: 20, raEndDeg: 21, decMinDeg: 90 })).toHaveLength(3)
})
test('parallel waves respect consumer backpressure and independent row admission', async () => {
  const { files, manifest: m } = await syntheticPartition()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const fetcher = vi.fn(async (url: URL | RequestInfo) => response(files.get(String(url).split('/').at(-1)!)!))
  const onChunk = vi.fn(async () => { await held })
  const pending = streamGaiaChunks({ manifest: m, region, baseUrl: 'https://example.test/gaia/', signal: new AbortController().signal, concurrency: 3, maxInFlightRows: 2, fetcher, onChunk })
  await vi.waitFor(() => expect(onChunk).toHaveBeenCalledTimes(1))
  expect(fetcher).toHaveBeenCalledTimes(2)
  release(); const result = await pending
  expect(result.verifiedChunks).toBe(3); expect(result.peakReservedRows).toBe(2)
  expect(fetcher).toHaveBeenCalledTimes(3)
})
test('cancelling while a consumer is active prevents queued publication and later requests', async () => {
  const { files, manifest: m } = await syntheticPartition(), controller = new AbortController()
  const fetcher = vi.fn(async (url: URL | RequestInfo) => response(files.get(String(url).split('/').at(-1)!)!))
  const onChunk = vi.fn(async () => { controller.abort() })
  await expect(streamGaiaChunks({ manifest: m, region, baseUrl: 'https://example.test/gaia/', signal: controller.signal, concurrency: 2, fetcher, onChunk })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).toHaveBeenCalledTimes(2); expect(onChunk).toHaveBeenCalledTimes(1)
})
