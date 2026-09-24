import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_STREAM_ARTIFACT_TIMEOUT_MS, createCatalogStreamSourceCache, clearCatalogStreamSourceCache, planCatalogStream, streamCatalogPoints, type CatalogStreamTile } from '../../src/lib/catalogStreaming'
import { utcJulianDayToTt } from '../../src/engine/ephemeris/timeScales'
import { prepareCatalogAppendBatch } from '../../src/lib/catalogAppendBatch'
import { checkCatalogAppendReceipt } from '../../src/lib/catalogAppendReceipt'
import type { AsteroidIndexEntry, AsteroidManifest, CatalogFilters } from '../../src/types'

const filters: CatalogFilters = { query: '', orbitClass: 'all', semiMajorAxis: [0, 100], eccentricity: [0, 1], inclination: [0, 180], absoluteMagnitude: [-10, 40], magnitudeStatus: 'all', perihelion: [0, 100] }
const hash = (buffer: ArrayBuffer) => createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

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
    const chunkId = `chunk-${String(chunk).padStart(4, '0')}`
    const metadata: AsteroidIndexEntry[] = Array.from({ length: rows }, (_, row) => {
      const i = chunk*chunkSize+row
      return { id: `synthetic-${i}`, label: `Synthetic ${i}`, shortLabel: `S${i}`,
        searchKey: `synthetic ${i} named exact selection`, chunkId, chunkIndex: chunk, rowIndex: row,
        orbitClassCode: i%2 ? 'APO' : 'MBA', orbitClassName: i%2 ? 'Apollo' : 'Main belt',
        ...(i%2 ? {} : { absoluteMagnitude: 12 }), isNeo: Boolean(i%2), isPha: Boolean(i%2) }
    })
    files.set(`meta/${chunkId}.json`,new TextEncoder().encode(JSON.stringify(metadata)).buffer)
  }
  files.set('catalog-index.bin', compact)
  // Rehash bytes only; never repair intentionally inconsistent source metadata.
  const rehash = () => {
    const descriptor = Object.fromEntries([...files].filter(([key]) => key !== 'checksums.json')
      .sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => [key,hash(value)]))
    manifest.contentSha256 = hash(new TextEncoder().encode(JSON.stringify(descriptor)).buffer)
    files.set('checksums.json',new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files: descriptor })).buffer)
  }
  const setSourceFlags = (sourceRow: number, flags: number) => {
    index.setUint8(sourceRow*24+19,flags)
    const path = `meta/chunk-${String(Math.floor(sourceRow/chunkSize)).padStart(4,'0')}.json`
    const metadata = JSON.parse(new TextDecoder().decode(files.get(path)!)) as AsteroidIndexEntry[]
    const entry = metadata[sourceRow%chunkSize]
    entry.isNeo = Boolean(flags&1); entry.isPha = Boolean(flags&2)
    files.set(path,new TextEncoder().encode(JSON.stringify(metadata)).buffer)
  }
  rehash()
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = url.replace('/test/', '')
    requests.push(key)
    if (!files.has(key)) throw new Error(`Unexpected artifact ${key}`)
    return new Response(files.get(key)!.slice(0))
  }))
  return { manifest, files, requests, rehash, setSourceFlags }
}

function run(manifest: AsteroidManifest, onTile: (tile: CatalogStreamTile) => Promise<void>, overrides: Partial<Parameters<typeof streamCatalogPoints>[0]> = {}) {
  return streamCatalogPoints({ manifest, filters, julianDay: 2461287.5, requestedRows: 100, budgetBytes: 32 * 1024 * 1024, signal: new AbortController().signal, onTile, ...overrides })
}

describe('bounded source catalog streaming', () => {
  it('prepares selected append rows in priority-shard order and reports capacity omissions', async () => {
    const { manifest,files } = fixture(6,2)
    const request = { manifest, filters, mode: '2d' as const, julianDay: 2461287.5,
      budgetBytes: 32*1024*1024, maximumRows: 1,
      locators: [{ chunkIndex: 2, rowIndex: 1 },{ chunkIndex: 0, rowIndex: 1 }],
      contentSha256: manifest.contentSha256!, indexSha256: hash(files.get('catalog-index.bin')!),
      signal: new AbortController().signal }
    const limited = await prepareCatalogAppendBatch(request)
    expect([...limited.positions]).toEqual([2.05,0])
    expect(limited.prepared.count).toBe(1)
    expect(limited.result).toMatchObject({ drawnRows: 1, complete: false, screening: { completionReason: 'capacity' } })
    expect(limited.result.sourceSelection!.shards.map(shard => [shard.chunk,...shard.selectedRows])).toEqual([[2,2]])
    const complete = await prepareCatalogAppendBatch({ ...request,maximumRows: 2 })
    expect([...complete.positions]).toEqual([2.05,0,2.01,0])
    expect(complete.prepared.count).toBe(2)
    expect(complete.result).toMatchObject({ drawnRows: 2, complete: true })
  })

  it('returns an empty checked append when source names reject every candidate', async () => {
    const { manifest,files,requests } = fixture(3,3)
    const batch = await prepareCatalogAppendBatch({ manifest, filters: { ...filters,query: 'absent name' },
      mode: '3d', julianDay: 2461287.5, budgetBytes: 32*1024*1024, maximumRows: 2,
      locators: [{ chunkIndex: 0,rowIndex: 1 }], contentSha256: manifest.contentSha256!,
      indexSha256: hash(files.get('catalog-index.bin')!), signal: new AbortController().signal })
    expect(batch.positions).toHaveLength(0)
    expect(batch.appearance).toHaveLength(0)
    expect(batch.prepared.count).toBe(0)
    expect(batch.result).toMatchObject({ drawnRows: 0, complete: true, screening: { metadataOnlyRows: 3 } })
    expect(requests.some(path => path.startsWith('binary/'))).toBe(false)
  })

  it('rejects a receipt that places an admitted row beyond its examined source prefix', async () => {
    const { manifest,files } = fixture(4,4)
    const request = { manifest, filters, mode: '2d' as const, julianDay: 2461287.5,
      budgetBytes: 32*1024*1024, maximumRows: 1,
      locators: [0,1,3].map(rowIndex => ({ chunkIndex: 0,rowIndex })),
      contentSha256: manifest.contentSha256!, indexSha256: hash(files.get('catalog-index.bin')!),
      signal: new AbortController().signal }
    const batch = await prepareCatalogAppendBatch(request)
    expect(batch.result.screening.shards[0].examinedRows).toBe(2)
    const tampered = structuredClone(batch.result)
    tampered.sourceSelection!.shards[0].selectedRows[0] = 8
    expect(() => checkCatalogAppendReceipt(tampered,request)).toThrow('requested sources')
  })

  it('rejects cancellation during capacity-result prefetch drain and releases the source cache', async () => {
    const { manifest, files } = fixture(4,1)
    const sourceCache = createCatalogStreamSourceCache(96,64)
    const controller = new AbortController(), originalFetch = globalThis.fetch
    let published = false, cancelledDuringDrain = false
    vi.stubGlobal('fetch',vi.fn((url: string, options: RequestInit) => {
      if (!url.endsWith('/binary/chunk-0001.bin')) return originalFetch(url,options)
      // Hold one speculative fetch until the loader cancels its own prefetch
      // controller on reaching capacity. Deliver caller cancellation only then.
      return new Promise<Response>(resolve => {
        options.signal!.addEventListener('abort',() => {
          queueMicrotask(() => {
            cancelledDuringDrain = published
            controller.abort()
            resolve(new Response(files.get('binary/chunk-0001.bin')!.slice(0)))
          })
        },{ once: true })
      })
    }))
    await expect(run(manifest,async () => { published = true },
      { requestedRows: 1, sourceCache, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelledDuringDrain).toBe(true)
    vi.stubGlobal('fetch',originalFetch)
    const recovered = await run(manifest,async () => {},{ sourceCache })
    expect(recovered).toMatchObject({ drawnRows: 4, complete: true,
      reads: { indexCacheHits: 0, binaryCacheHits: 0 } })
  })

  it('rejects a concurrent cache lease without invalidating its owning load', async () => {
    const { manifest, requests } = fixture(3,3)
    const sourceCache = createCatalogStreamSourceCache(72,192)
    let release!: () => void, arrive!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const arrived = new Promise<void>(resolve => { arrive = resolve })
    const first = run(manifest,async () => { arrive(); await held },{ sourceCache })
    try {
      await Promise.race([arrived,first.then(() => { throw new Error('Expected a held source tile') })])
      const before = requests.length
      await expect(run(manifest,async () => {},{ sourceCache })).rejects.toThrow('busy')
      expect(requests).toHaveLength(before)
    } finally { release(); await first }
    const reused = await run(manifest,async () => {},{ sourceCache })
    expect(reused.reads).toMatchObject({ indexCacheHits: 1, binaryCacheHits: 1 })
  })

  it('reuses checked source bytes but rechecks metadata and reapplies changed filters', async () => {
    const { manifest, requests, files } = fixture(3,3)
    const sourceCache = createCatalogStreamSourceCache(72,192)
    await run(manifest,async () => {},{ sourceCache })
    requests.length = 0
    const positions: number[] = []
    const result = await run(manifest,async tile => { positions.push(...tile.positions) },
      { sourceCache, filters: { ...filters, magnitudeStatus: 'unknown' } })
    expect(requests).toEqual(['meta/chunk-0000.json'])
    expect(positions).toEqual([2.01,0])
    expect(result.sourceSelection!.shards.map(shard => [...shard.selectedRows])).toEqual([[2]])
    const zero = { attempts: 0, completed: 0, failed: 0, completedBytes: 0 }
    expect(result.reads).toEqual({ method: 'catalog-application-reads-v1',
      indexCacheHits: 1, indexReusedBytes: 72, binaryCacheHits: 1, binaryReusedBytes: 192,
      artifacts: { checksums: zero, index: zero, binary: zero,
        metadata: { attempts: 1, completed: 1, failed: 0, completedBytes: files.get('meta/chunk-0000.json')!.byteLength } } })
    expect(Object.isFrozen(result.reads)).toBe(true)
    expect(Object.isFrozen(result.reads.artifacts)).toBe(true)
    expect(Object.values(result.reads.artifacts).every(Object.isFrozen)).toBe(true)
  })

  it.each(['clear','source-change'] as const)('refetches retained bytes after %s', async reason => {
    const { manifest, requests, setSourceFlags, rehash } = fixture(3,3)
    const sourceCache = createCatalogStreamSourceCache(72,192)
    const first = await run(manifest,async () => {},{ sourceCache })
    if (reason === 'clear') clearCatalogStreamSourceCache(sourceCache)
    else { setSourceFlags(1,1); rehash() }
    requests.length = 0
    const result = await run(manifest,async () => {},{ sourceCache })
    expect(new Set(requests)).toEqual(new Set(['checksums.json','catalog-index.bin','meta/chunk-0000.json','binary/chunk-0000.bin']))
    expect(requests).toHaveLength(4)
    expect(result.reads).toMatchObject({ indexCacheHits: 0, binaryCacheHits: 0,
      artifacts: { checksums: { completed: 1 }, index: { completed: 1 }, binary: { completed: 1 }, metadata: { completed: 1 } } })
    if (reason === 'source-change') expect(result.sourceSelection!.contentSha256).not.toBe(first.sourceSelection!.contentSha256)
    else expect(result.sourceSelection).toEqual(first.sourceSelection)
  })

  it('rejects changed metadata on a cache hit and drops the cache before recovery', async () => {
    const { manifest, requests, files } = fixture(3,3)
    const sourceCache = createCatalogStreamSourceCache(72,192)
    await run(manifest,async () => {},{ sourceCache })
    const path = 'meta/chunk-0000.json', original = files.get(path)!
    const changed = original.slice(0)
    new Uint8Array(changed)[0] ^= 1
    files.set(path,changed) // Keep the trusted descriptor unchanged.
    const publish = vi.fn(async () => {})
    await expect(run(manifest,publish,{ sourceCache })).rejects.toThrow()
    expect(publish).not.toHaveBeenCalled()
    files.set(path,original); requests.length = 0
    const recovered = await run(manifest,async () => {},{ sourceCache })
    expect(recovered).toMatchObject({ drawnRows: 3, complete: true,
      reads: { indexCacheHits: 0, binaryCacheHits: 0 } })
    expect(requests).toHaveLength(4)
  })

  it.each(['neo-first', 'pha-first'] as const)('prioritizes %s shards stably while retaining ordinary rows and every source exactly once', async priority => {
    const { manifest, requests, rehash, setSourceFlags } = fixture(13, 2)
    for (let row = 0; row < 13; row++) setSourceFlags(row,row % 2 ? 0 : 4)
    // Only a late shard has the requested tag; an earlier shard has the other tag.
    setSourceFlags(11, priority === 'neo-first' ? 1 : 2)
    setSourceFlags(3, priority === 'neo-first' ? 2 : 1)
    rehash()
    const values: number[] = []
    const result = await run(manifest, async tile => { for (let i = 0; i < tile.positions.length; i += 2) values.push(tile.positions[i]) }, { priority })
    expect(result).toMatchObject({ sourceRows: 13, drawnRows: 13, complete: true })
    expect(values).toEqual([10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(row => 2 + row / 100))
    expect(requests.filter(path => path.startsWith('binary/'))).toEqual([5, 0, 1, 2, 3, 4, 6].map(chunk => `binary/chunk-${String(chunk).padStart(4, '0')}.bin`))
    const limited: number[] = []
    expect(await run(manifest, async tile => { limited.push(...tile.positions) }, { priority, requestedRows: 2 })).toMatchObject({ drawnRows: 2, complete: false })
    expect(limited).toEqual([2.1, 0, 2.11, 0])
  })
  it('rejects unknown source priorities before fetching', async () => {
    const { manifest, requests } = fixture()
    await expect(run(manifest, async () => {}, { priority: 'unknown' as never })).rejects.toThrow('source priority')
    expect(requests).toEqual([])
  })
  it('does not elevate a shard for a tagged row excluded by exact name locators or index filters', async () => {
    const { manifest, requests, rehash, setSourceFlags } = fixture(13, 2)
    for (let row = 0; row < 13; row++) setSourceFlags(row,row % 2 ? 0 : 4)
    setSourceFlags(11,1)
    rehash()
    const values: number[] = []
    await run(manifest, async tile => { for (let i = 0; i < tile.positions.length; i += 2) values.push(tile.positions[i]) }, {
      priority: 'neo-first', filters: { ...filters, query: 'exact selection' }, candidateLocators: new Uint32Array([0, 0, 5, 0]),
    })
    expect(values).toEqual([2, 2.1])
    expect(requests.filter(path => path.startsWith('binary/'))).toEqual(['binary/chunk-0000.bin', 'binary/chunk-0005.bin'])
    requests.length = 0
    await run(manifest, async () => {}, { priority: 'neo-first', filters: { ...filters, semiMajorAxis: [2, 2.105] } })
    expect(requests.filter(path => path.startsWith('binary/'))[0]).toBe('binary/chunk-0000.bin')
  })
  it('streams Float64 inclined 3D states and reserves every added coordinate buffer', async () => {
    const { manifest,files,rehash } = fixture(3,3)
    const elements = new Float64Array(files.get('binary/chunk-0000.bin')!), index = new DataView(files.get('catalog-index.bin')!)
    for (let row = 0; row < 3; row++) { elements[row*8+3] = 90; elements[row*8+5] = 90; index.setUint32(row*24+12,90000000,true) }
    rehash()
    const positions: number[] = []
    await run(manifest,async tile => { expect(tile.positions).toBeInstanceOf(Float64Array); positions.push(...tile.positions) },{mode: '3d'})
    expect(positions).toHaveLength(9)
    for (let row = 0; row < 3; row++) {
      expect(Math.abs(positions[row*3])).toBeLessThan(1e-14)
      expect(Math.abs(positions[row*3+1])).toBeLessThan(1e-14)
      expect(positions[row*3+2]).toBe(2+row/100)
    }
    const two = planCatalogStream(manifest,3,32*1024*1024), three = planCatalogStream(manifest,3,32*1024*1024,'3d')
    // Three extra display coordinates (CPU/GPU/culling) per row, plus one
    // additional min/max Float64 axis in this fixture's single spatial block.
    expect(three.reservedBytes-two.reservedBytes).toBe(3*12+2*8)
  })
  it('uses every source row once in source order, preserving flags and an independently known circular state', async () => {
    const { manifest, requests, files } = fixture(), positions: number[] = [], flags: number[] = []
    const result = await run(manifest, async tile => {
      expect(tile.positions).toBeInstanceOf(Float64Array)
      positions.push(...tile.positions); flags.push(...tile.appearance)
    })
    expect(result).toMatchObject({ sourceRows: 13, drawnRows: 13, complete: true,
      screening: { admittedShards: 7, completedShards: 7, metadataOnlyRows: 0, completionReason: 'exhausted' },
      sourceSelection: { contentSha256: manifest.contentSha256, indexSha256: hash(files.get('catalog-index.bin')!) } })
    const completed = (paths: string[]) => ({ attempts: paths.length, completed: paths.length, failed: 0,
      completedBytes: paths.reduce((total,path) => total+files.get(path)!.byteLength,0) })
    expect(result.reads).toEqual({ method: 'catalog-application-reads-v1', indexCacheHits: 0, indexReusedBytes: 0,
      binaryCacheHits: 0, binaryReusedBytes: 0, artifacts: {
        checksums: completed(['checksums.json']), index: completed(['catalog-index.bin']),
        metadata: completed([...files.keys()].filter(path => path.startsWith('meta/'))),
        binary: completed([...files.keys()].filter(path => path.startsWith('binary/'))),
      } })
    expect(result.sourceSelection!.shards.map(shard => [...shard.selectedRows])).toEqual([[3],[3],[3],[3],[3],[3],[1]])
    for (let row = 0; row < 13; row++) {
      expect(positions[row * 2]).toBe(2 + row / 100); expect(positions[row * 2 + 1]).toBe(0)
      expect(flags.slice(row * 2, row * 2 + 2)).toEqual([row % 2, row % 2 ? 3 : 4])
    }
    expect(requests).toHaveLength(16)
    expect(requests.filter(path => path.startsWith('meta/'))).toHaveLength(7)
    expect(requests.some(path => path.includes('sample'))).toBe(false)
  })

  it('holds four prefetched shards plus one active compute shard until upload acknowledgement', async () => {
    const { manifest, requests } = fixture(), controller = new AbortController()
    let acknowledge!: () => void, arrived!: () => void
    const tileReady = new Promise<void>(resolve => { arrived = resolve })
    const result = run(manifest, () => new Promise<void>(resolve => { acknowledge = resolve; arrived() }), { signal: controller.signal })
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await tileReady
    expect(requests.filter(path => path.startsWith('binary/'))).toHaveLength(5)
    controller.abort(); acknowledge()
    await rejection
    expect(requests.filter(path => path.startsWith('binary/'))).toHaveLength(5)
  })

  it('reports a one-row truncation as partial even when the truncated row is the end of the last shard', async () => {
    const { manifest } = fixture(3, 3), counts: number[] = []
    expect(await run(manifest, async tile => { counts.push(tile.drawnRows) }, { requestedRows: 2 })).toMatchObject({ sourceRows: 3, drawnRows: 2, complete: false })
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

  it.each(['checksums.json', 'catalog-index.bin', '/binary/'])('times out a stalled %s body and returns leases for a fresh load', async stalled => {
    vi.useFakeTimers()
    const { manifest } = fixture(), original = globalThis.fetch, published = vi.fn(async () => {})
    let started = 0, cancelled = 0, ready!: () => void
    const expected = stalled === '/binary/' ? 4 : 1
    const waiting = new Promise<void>(resolve => { ready = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (!url.includes(stalled)) return original(url, options)
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(new Uint8Array([0])); if (++started === expected) ready() },
        cancel() { cancelled++ },
      }))
    }))
    const result = run(manifest, published)
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await waiting
    await vi.advanceTimersByTimeAsync(CATALOG_STREAM_ARTIFACT_TIMEOUT_MS)
    await rejection
    expect(cancelled).toBe(expected)
    expect(published).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.stubGlobal('fetch', original)
    vi.useRealTimers()
    await expect(run(manifest, async () => {})).resolves.toMatchObject({ drawnRows: 13, complete: true })
  })

  it('aborts a request that never returns headers and can reload afterwards', async () => {
    vi.useFakeTimers()
    const { manifest } = fixture(), original = globalThis.fetch
    let ready!: () => void, aborted = 0
    const waiting = new Promise<void>(resolve => { ready = resolve })
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => { aborted++; reject(options.signal!.reason) }, { once: true })
      ready()
    })))
    const result = run(manifest, async () => { throw new Error('No response was received') })
    const rejection = expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    await waiting
    await vi.advanceTimersByTimeAsync(CATALOG_STREAM_ARTIFACT_TIMEOUT_MS)
    await rejection
    expect(aborted).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    vi.stubGlobal('fetch', original)
    vi.useRealTimers()
    await expect(run(manifest, async () => {})).resolves.toMatchObject({ complete: true })
  })

  it('uses query locators without duplicates and applies full source precision and unknown magnitude filters', async () => {
    const { manifest, requests } = fixture()
    const result = await run(manifest, async () => {}, {
      candidateLocators: new Uint32Array([0, 1, 0, 1, 6, 0]), filters: { ...filters, query: 'named', magnitudeStatus: 'unknown' },
    })
    expect(result).toMatchObject({ drawnRows: 1, complete: true })
    // Both candidate shards match the name. Magnitude eligibility is checked
    // against source metadata alongside their original orbital records.
    expect(requests.filter(path => path.startsWith('binary/'))).toEqual(['binary/chunk-0000.bin','binary/chunk-0006.bin'])
    await expect(run(manifest, async () => {}, { filters: { ...filters, query: 'named' } })).resolves.toMatchObject({ drawnRows: 13, complete: true })
  })

  it('skips shards excluded by exact indexed fields without claiming their source rows were scanned', async () => {
    const { manifest, requests } = fixture()
    const result = await run(manifest, async () => {}, { filters: { ...filters, semiMajorAxis: [2.12, 3], orbitClass: 'MBA', magnitudeStatus: 'known' } })
    expect(requests.filter(path => path.startsWith('binary/'))).toEqual(['binary/chunk-0006.bin'])
    expect(result).toMatchObject({ sourceRows: 1, drawnRows: 1, complete: true })
  })

  it('finishes an index-excluded query without fetching source shards or publishing empty tiles', async () => {
    const { manifest, requests } = fixture(), published = vi.fn(async () => {})
    expect(await run(manifest, published, { filters: { ...filters, semiMajorAxis: [10, 20] } })).toMatchObject({ sourceRows: 0, drawnRows: 0, complete: true })
    expect(requests).toEqual(['checksums.json', 'catalog-index.bin'])
    expect(published).not.toHaveBeenCalled()
  })

  it('keeps shards that match source e/i/perihelion even when their quantized index crosses a boundary', async () => {
    const { manifest, files, rehash, requests } = fixture(1, 1)
    const elements = new Float64Array(files.get('binary/chunk-0000.bin')!)
    elements[2] = .1000000004; elements[3] = 10.0000004
    const index = new DataView(files.get('catalog-index.bin')!)
    index.setUint32(8, 100_000_000, true); index.setUint32(12, 10_000_000, true)
    rehash()
    const perihelion = elements[1]*(1-elements[2])
    expect(await run(manifest, async () => {}, { filters: { ...filters, eccentricity: [.1000000003, .2], inclination: [10.0000003, 11], perihelion: [perihelion, perihelion] } })).toMatchObject({ drawnRows: 1, complete: true })
    expect(requests).toContain('binary/chunk-0000.bin')
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
    const plan = planCatalogStream(full, full.totalCount, 512 * 1024 * 1024)
    expect(plan.capacity).toBe(full.totalCount)
    expect(plan.reservedBytes).toBeLessThanOrEqual(plan.budgetBytes)
    const constrained = planCatalogStream(full,full.totalCount,256*1024*1024)
    expect(constrained.capacity).toBeGreaterThan(0)
    expect(constrained.capacity).toBeLessThan(full.totalCount)
    expect(constrained.reservedBytes).toBeLessThanOrEqual(constrained.budgetBytes)
    expect(planCatalogStream(full, full.totalCount, 64 * 1024 * 1024).capacity).toBe(0)
  })
})
