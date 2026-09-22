import { afterEach, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import type { AsteroidManifest, CatalogScanWorkerCancelRequest, CatalogScanWorkerRequest, CatalogScanWorkerResponse } from '../../src/types'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const manifest: AsteroidManifest = { version: 'test', source: 'fixture', generatedAt: '2026-09-22', totalCount: 1, chunkCount: 1, chunkSize: 1, format: 'binary-v1', releasePath: '/scan-test', capabilities: ['gzip-json-v1'], bucketCounts: {}, categoryCounts: {}, featured: [] }
const request = (requestId: number, extra: Partial<CatalogScanWorkerRequest> = {}): CatalogScanWorkerRequest => ({
  type: 'scan', requestId, scanKey: String(requestId), manifest, sampleLimit: 10,
  filters: { query: 'alpha', orbitClass: 'all', semiMajorAxis: [0, 100], eccentricity: [0, 1], inclination: [0, 180], absoluteMagnitude: [-100, 100], perihelion: [0, 100], magnitudeStatus: 'all' }, ...extra,
})
async function worker() {
  const messages: CatalogScanWorkerResponse[] = []
  const scope = { onmessage: null as ((event: MessageEvent<CatalogScanWorkerRequest | CatalogScanWorkerCancelRequest>) => void) | null, postMessage: (message: CatalogScanWorkerResponse) => messages.push(message) }
  vi.stubGlobal('self', scope)
  await import('../../src/workers/catalog-scan.worker')
  return { messages, send: (data: CatalogScanWorkerRequest | CatalogScanWorkerCancelRequest) => scope.onmessage!({ data } as MessageEvent<typeof data>) }
}

it('scans gzip-only metadata and rejects corrupt binary rows instead of reporting zero matches', async () => {
  let corrupt = true
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('.json.gz')) return new Response(new Uint8Array(gzipSync(JSON.stringify([{ id: 'asteroid:1', searchKey: 'alpha', orbitClassCode: 'MBA' }]))))
    if (url.endsWith('.bin')) return new Response(new Float64Array([2451545, corrupt ? NaN : 2, .1, 0, 0, 0, 0, 1]))
    return new Response(null, { status: 404 })
  }))
  const { messages, send } = await worker()
  send(request(1))
  await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('error'))
  corrupt = false
  send(request(2))
  await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', total: 1 }))
  expect(urls.some(url => url.endsWith('/meta/chunk-0000.json.gz'))).toBe(true)
  expect(urls.some(url => url.endsWith('.json'))).toBe(false)
})

it('does not publish progress or results after cancellation during a shard download', async () => {
  let release!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve })))
  const { messages, send } = await worker()
  send(request(1, { manifest: { ...manifest, format: 'json-v1', capabilities: [] } }))
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  send({ type: 'cancel', requestId: 1 })
  release(new Response('[]'))
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(messages).toEqual([])
})

it('evicts old compact indexes while retaining only two release buffers', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response(new ArrayBuffer(0)) }))
  const { messages, send } = await worker()
  for (const [index, release] of ['one', 'two', 'three', 'one'].entries()) {
    send(request(index + 1, { candidateLocators: new Uint32Array(), manifest: { ...manifest, releasePath: `/${release}`, compactIndex: { path: 'index.bin', format: 'catalog-index-v1', strideBytes: 24, count: 0, classCodes: [] } } }))
    await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', requestId: index + 1 }))
  }
  expect(urls.filter(url => url === '/one/index.bin')).toHaveLength(2)
})

it('cancels in-flight compact bytes and starts a replacement without inheriting aborted data', async () => {
  let firstSignal!: AbortSignal
  const cancelled = vi.fn()
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    firstSignal = init.signal!
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })))
  })
  vi.stubGlobal('fetch', fetcher)
  const { messages, send } = await worker()
  const extra = { candidateLocators: new Uint32Array(), manifest: { ...manifest, compactIndex: { path: 'index.bin', format: 'catalog-index-v1' as const, strideBytes: 24, count: 0, classCodes: [] } } }
  send(request(1, extra))
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  send({ type: 'cancel', requestId: 1 })
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))
  expect(firstSignal.aborted).toBe(true)
  fetcher.mockImplementation(async () => new Response(new ArrayBuffer(0)))
  send(request(2, extra))
  await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', requestId: 2, total: 0 }))
  expect(messages.every(message => message.requestId === 2)).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('aborts unfinished metadata when its paired numeric shard fails validation', async () => {
  const cancelled = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.json.gz')
    ? new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }))
    : new Response(new Float64Array([2451545, NaN, .1, 0, 0, 0, 0, 1]))))
  const { messages, send } = await worker()
  send(request(1))
  await vi.waitFor(() => expect(messages.at(-1)?.type).toBe('error'))
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))
})

it('decodes the published 24-byte index layout and rejects row aliases across chunk boundaries', async () => {
  const buffer = new ArrayBuffer(48), view = new DataView(buffer)
  for (const offset of [0, 24]) {
    view.setFloat64(offset, 2.5, true)
    view.setUint32(offset + 8, 100_000_000, true)
    view.setUint32(offset + 12, 5_000_000, true)
    view.setInt16(offset + 16, 0x7fff, true)
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(buffer)))
  const { messages, send } = await worker()
  const dataset = { ...manifest, chunkCount: 2, compactIndex: { path: 'index.bin', format: 'catalog-index-v1' as const, strideBytes: 24, count: 2, classCodes: ['MBA'] } }
  send(request(1, { manifest: dataset, candidateLocators: new Uint32Array([1, 0]) }))
  await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'result', total: 1, locators: new Uint32Array([1, 0]) }))
  send(request(2, { manifest: dataset, candidateLocators: new Uint32Array([0, 1]) }))
  await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({ type: 'error', error: 'Search locator is outside compact index: 0:1' }))
})
