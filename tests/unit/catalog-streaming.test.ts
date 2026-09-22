import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planCatalogStream, streamCatalogPoints, type CatalogStreamTile } from '../../src/lib/catalogStreaming'
import { utcJulianDayToTt } from '../../src/engine/ephemeris/timeScales'
import type { AsteroidManifest, CatalogFilters } from '../../src/types'

const filters: CatalogFilters = { query: '', orbitClass: 'all', semiMajorAxis: [0, 100], eccentricity: [0, 1], inclination: [0, 180], absoluteMagnitude: [-10, 40], magnitudeStatus: 'all', perihelion: [0, 100] }
const hash = (buffer: ArrayBuffer) => createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
afterEach(() => vi.unstubAllGlobals())

function fixture(count = 13, chunkSize = 2) {
  const manifest: AsteroidManifest = { version: 'test', source: 'synthetic circular orbits', generatedAt: '', totalCount: count, chunkSize, chunkCount: Math.ceil(count / chunkSize), format: 'binary-v1', releasePath: '/test', compactIndex: { path: 'catalog-index.bin', format: 'catalog-index-v1', strideBytes: 24, count, classCodes: ['MBA', 'APO'] }, bucketCounts: {}, categoryCounts: {}, featured: [] }
  const files = new Map<string, ArrayBuffer>(), compact = new ArrayBuffer(count * 24), index = new DataView(compact)
  const epoch = utcJulianDayToTt(2461287.5)
  for (let chunk = 0; chunk < manifest.chunkCount; chunk++) {
    const rows = Math.min(chunkSize, count - chunk * chunkSize), elements = new Float64Array(rows * 8)
    for (let row = 0; row < rows; row++) {
      const i = chunk * chunkSize + row, offset = i * 24, a = 2 + i / 100
      // At the source epoch a circular, unrotated orbit lies at (a, 0).
      elements.set([epoch, a, 0, 0, 0, 0, 0, .2], row * 8)
      index.setFloat64(offset, a, true)
      index.setInt16(offset + 16, i % 2 ? 0x7fff : 1200, true)
      index.setUint8(offset + 18, i % 2)
      index.setUint8(offset + 19, i % 2 ? 3 : 4)
      index.setUint16(offset + 20, chunk, true); index.setUint16(offset + 22, row, true)
    }
    files.set(`binary/chunk-${String(chunk).padStart(4, '0')}.bin`, elements.buffer)
  }
  files.set('catalog-index.bin', compact)
  const rehash = () => files.set('checksums.json', new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files: Object.fromEntries([...files].filter(([key]) => key !== 'checksums.json').map(([key, value]) => [key, hash(value)])) })).buffer)
  rehash()
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = url.replace('/test/', '')
    requests.push(key)
    if (!files.has(key)) throw new Error(`Unexpected artifact ${key}`)
    return new Response(files.get(key)!.slice(0))
  }))
  return { manifest, files, requests, rehash }
}

function run(manifest: AsteroidManifest, onTile: (tile: CatalogStreamTile) => Promise<void>, overrides: Partial<Parameters<typeof streamCatalogPoints>[0]> = {}) {
  return streamCatalogPoints({ manifest, filters, julianDay: 2461287.5, requestedRows: 100, budgetBytes: 32 * 1024 * 1024, signal: new AbortController().signal, onTile, ...overrides })
}

describe('bounded source catalog streaming', () => {
  it('uses every source row once in source order, preserving flags and an independently known circular state', async () => {
    const { manifest, requests } = fixture(), positions: number[] = [], flags: number[] = []
    const result = await run(manifest, async tile => {
      expect(tile.positions).toBeInstanceOf(Float64Array)
      positions.push(...tile.positions); flags.push(...tile.appearance)
    })
    expect(result).toEqual({ sourceRows: 13, drawnRows: 13, complete: true })
    for (let row = 0; row < 13; row++) {
      expect(positions[row * 2]).toBe(2 + row / 100); expect(positions[row * 2 + 1]).toBe(0)
      expect(flags.slice(row * 2, row * 2 + 2)).toEqual([row % 2, row % 2 ? 3 : 4])
    }
    expect(requests).toHaveLength(9)
    expect(requests.some(path => path.includes('meta') || path.includes('sample'))).toBe(false)
  })

  it('holds admission at four shards until upload acknowledgement and cancels before admitting a fifth', async () => {
    const { manifest, requests } = fixture(), controller = new AbortController()
    let acknowledge!: () => void, arrived!: () => void
    const tileReady = new Promise<void>(resolve => { arrived = resolve })
    const result = run(manifest, () => new Promise<void>(resolve => { acknowledge = resolve; arrived() }), { signal: controller.signal })
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await tileReady
    expect(requests.filter(path => path.startsWith('binary/'))).toHaveLength(4)
    controller.abort(); acknowledge()
    await rejection
    expect(requests.filter(path => path.startsWith('binary/'))).toHaveLength(4)
  })

  it('reports a one-row truncation as partial even when the truncated row is the end of the last shard', async () => {
    const { manifest } = fixture(3, 3), counts: number[] = []
    expect(await run(manifest, async tile => { counts.push(tile.drawnRows) }, { requestedRows: 2 })).toEqual({ sourceRows: 3, drawnRows: 2, complete: false })
    expect(counts).toEqual([2])
    expect(await run(manifest, async () => {}, { requestedRows: 3 })).toMatchObject({ drawnRows: 3, complete: true })
  })

  it('aborts all four stalled source bodies and returns their admission leases for a fresh request', async () => {
    const { manifest } = fixture(), controller = new AbortController(), original = globalThis.fetch
    let started = 0, cancelled = 0, ready!: () => void
    const allStarted = new Promise<void>(resolve => { ready = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (!url.includes('/binary/')) return original(url, options)
      const body = new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(new Uint8Array([0])); if (++started === 4) ready() },
        cancel() { cancelled++ },
      })
      return new Response(body)
    }))
    const result = run(manifest, async () => { throw new Error('A partial shard must not be published') }, { signal: controller.signal })
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await allStarted
    controller.abort(); await rejection
    expect(cancelled).toBe(4)
    vi.stubGlobal('fetch', original)
    await expect(run(manifest, async () => {})).resolves.toMatchObject({ drawnRows: 13, complete: true })
  })

  it('uses query locators without duplicates and applies full source precision and unknown magnitude filters', async () => {
    const { manifest, requests } = fixture()
    const result = await run(manifest, async () => {}, {
      candidateLocators: new Uint32Array([0, 1, 0, 1, 6, 0]), filters: { ...filters, query: 'named', magnitudeStatus: 'unknown' },
    })
    expect(result).toMatchObject({ drawnRows: 1, complete: true })
    expect(requests.filter(path => path.startsWith('binary/'))).toEqual(['binary/chunk-0000.bin', 'binary/chunk-0006.bin'])
    await expect(run(manifest, async () => {}, { filters: { ...filters, query: 'named' } })).rejects.toThrow('exact source locators')
  })

  it('does not round a source eccentricity across the filter boundary', async () => {
    const { manifest, files, rehash } = fixture(1, 1)
    const elements = new Float64Array(files.get('binary/chunk-0000.bin')!)
    elements[2] = .1000000004
    new DataView(files.get('catalog-index.bin')!).setUint32(8, 100_000_000, true)
    rehash()
    expect(await run(manifest, async () => {}, { filters: { ...filters, eccentricity: [0, .1] } })).toMatchObject({ drawnRows: 0, complete: true })
  })

  it.each(['hash', 'locator', 'metadata', 'orbit'] as const)('rejects %s corruption before publishing positions', async kind => {
    const { manifest, files, rehash } = fixture(1, 1), published = vi.fn(async () => {})
    const compact = new DataView(files.get('catalog-index.bin')!)
    if (kind === 'hash') compact.setUint8(0, 42)
    if (kind === 'locator') { compact.setUint16(22, 1, true); rehash() }
    if (kind === 'metadata') { compact.setUint8(19, 0); rehash() }
    if (kind === 'orbit') { new Float64Array(files.get('binary/chunk-0000.bin')!)[7] = NaN; rehash() }
    await expect(run(manifest, published)).rejects.toThrow()
    expect(published).not.toHaveBeenCalled()
  })

  it('rejects invalid epochs, source layouts, filters, and budgets before fetching', async () => {
    const { manifest, requests } = fixture()
    for (const julianDay of [NaN, Infinity, 2441317.4]) await expect(run(manifest, async () => {}, { julianDay })).rejects.toThrow('UTC epoch')
    await expect(run(manifest, async () => {}, { filters: { ...filters, eccentricity: [.2, .1] } })).rejects.toThrow('filter interval')
    expect(() => planCatalogStream({ ...manifest, chunkCount: 0 }, 10, 32 * 1024 * 1024)).toThrow('manifest')
    expect(() => planCatalogStream(manifest, Infinity, 32 * 1024 * 1024)).toThrow('budget')
    expect(planCatalogStream(manifest, 10, 1024).capacity).toBe(0)
    await expect(run(manifest, async () => {}, { budgetBytes: 1024 })).rejects.toThrow('budget')
    expect(requests).toHaveLength(0)
    const full = { ...manifest, totalCount: 1_561_171, chunkSize: 5000, chunkCount: 313, compactIndex: { ...manifest.compactIndex!, count: 1_561_171 } }
    const plan = planCatalogStream(full, full.totalCount, 256 * 1024 * 1024)
    expect(plan.capacity).toBe(full.totalCount)
    expect(plan.reservedBytes).toBeLessThanOrEqual(plan.budgetBytes)
    expect(planCatalogStream(full, full.totalCount, 64 * 1024 * 1024).capacity).toBe(0)
  })
})
