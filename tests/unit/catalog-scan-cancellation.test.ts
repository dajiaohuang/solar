import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATALOG_FILTERS } from '../../src/state/catalog-store'
import type { AsteroidManifest, AsteroidRecord, CatalogScanWorkerRequest, CatalogScanWorkerResponse } from '../../src/types'
import { discardCatalogScanPages, loadNextCatalogScanPage, resetCatalogScanWorker, scanAsteroidCatalog } from '../../src/lib/catalogScan'
import { loadAsteroidRecordsByLocators, loadAsteroidSearchLocators } from '../../src/lib/catalogLoader'

vi.mock('../../src/lib/catalogLoader', () => ({
  loadAsteroidRecordsByLocators: vi.fn(), loadAsteroidSearchLocators: vi.fn(),
}))
const hydrate = vi.mocked(loadAsteroidRecordsByLocators)
const search = vi.mocked(loadAsteroidSearchLocators)
const manifest = { version: 'fixture', chunkCount: 100, chunkSize: 5000 } as AsteroidManifest
const locators = Uint32Array.from(Array.from({ length: 15 }, (_, row) =>
  Array.from({ length: 40 }, (_, chunk) => [chunk, row])).flat(2))
const workers: FakeWorker[] = []
class FakeWorker {
  onmessage?: (event: MessageEvent<CatalogScanWorkerResponse>) => void
  onerror?: (event: ErrorEvent) => void
  requests: CatalogScanWorkerRequest[] = []
  constructor() { workers.push(this) }
  postMessage(request: CatalogScanWorkerRequest) { this.requests.push(request) }
  terminate() {}
  result(index: number, records?: AsteroidRecord[]) {
    const request = this.requests.filter(item => item.type === 'scan')[index]
    this.onmessage?.({ data: { type: 'result', requestId: request.requestId, scanKey: request.scanKey,
      total: 600, locators, ...(records === undefined ? {} : { records }) } } as MessageEvent<CatalogScanWorkerResponse>)
  }
}
const scan = (signal?: AbortSignal) => scanAsteroidCatalog({ manifest, filters: DEFAULT_CATALOG_FILTERS, sampleLimit: 2000, signal })

beforeEach(() => { workers.length = 0; vi.stubGlobal('Worker', FakeWorker); hydrate.mockReset(); search.mockReset() })
afterEach(() => { resetCatalogScanWorker(); vi.unstubAllGlobals() })

describe('catalog result hydration lifetime', () => {
  it('uses bounded scanned records for the first page and keeps locator paging', async () => {
    const records = Array.from({ length: 600 }, (_, index) => {
      const chunkIndex = locators[index * 2], rowIndex = locators[index * 2 + 1]
      return {
        id: `asteroid:${chunkIndex}:${rowIndex}`, label: `Body ${chunkIndex}:${rowIndex}`,
        shortLabel: `Body ${chunkIndex}:${rowIndex}`, searchKey: `body ${chunkIndex} ${rowIndex}`,
        chunkId: `chunk-${String(chunkIndex).padStart(4, '0')}`, chunkIndex, rowIndex,
        orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', isNeo: false, isPha: false,
        epochJd: 2_451_545, semiMajorAxisAU: 2.5, eccentricity: 0.1, inclinationDeg: 4,
        ascendingNodeDeg: 20, argPeriapsisDeg: 30, meanAnomalyDeg: 40, meanMotionDegPerDay: 0.5,
      } satisfies AsteroidRecord
    })
    const request = scan()
    workers.at(-1)!.result(0, records)
    const result = await request
    const expected = records.filter(record => record.chunkIndex! < 32).slice(0, 480)
    expect(result.records).toEqual(expected)
    expect(result.hasMore).toBe(true)
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('keeps cancellation active after the worker returns and prevents late hydration from replacing a new queue', async () => {
    let finishOld!: (records: AsteroidRecord[]) => void
    let oldSignal!: AbortSignal
    hydrate.mockImplementationOnce((_manifest, _locators, signal) => {
      oldSignal = signal!
      return new Promise(resolve => { finishOld = resolve })
    }).mockResolvedValue([])
    const controller = new AbortController()
    const old = scan(controller.signal)
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    workers.at(-1)!.result(0)
    controller.abort()
    await rejected
    expect(oldSignal.aborted).toBe(true)
    const fresh = scan()
    workers.at(-1)!.result(1)
    const result = await fresh
    expect(result.hasMore).toBe(true)
    finishOld([])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await loadNextCatalogScanPage(result.scanKey, manifest)).toMatchObject({ hasMore: false })
    expect(hydrate.mock.calls.at(-1)?.[1].length).toBe(120 * 2)
  })

  it('leaves a cancelled page available for retry and invalidates its active download on filter reset', async () => {
    hydrate.mockResolvedValue([])
    const initial = scan()
    workers.at(-1)!.result(0)
    const result = await initial
    const waitForAbort = (_manifest: AsteroidManifest, _locators: Uint32Array, signal?: AbortSignal) =>
      new Promise<AsteroidRecord[]>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
    hydrate.mockImplementationOnce(waitForAbort)
    const controller = new AbortController()
    const page = loadNextCatalogScanPage(result.scanKey, manifest, controller.signal)
    const rejected = expect(page).rejects.toMatchObject({ name: 'AbortError' })
    await expect(loadNextCatalogScanPage(result.scanKey, manifest)).rejects.toThrow('already loading')
    controller.abort()
    await rejected
    const cancelledLocators = hydrate.mock.calls.at(-1)![1]
    hydrate.mockImplementationOnce(waitForAbort)
    const replacement = loadNextCatalogScanPage(result.scanKey, manifest)
    const replacementError = expect(replacement).rejects.toMatchObject({ name: 'AbortError' })
    expect(hydrate.mock.calls.at(-1)![1]).toEqual(cancelledLocators)
    discardCatalogScanPages(result.scanKey)
    await replacementError
    expect(await loadNextCatalogScanPage(result.scanKey, manifest)).toEqual({ records: [], hasMore: false })
  })

  it('cancels search preflight without dispatching a worker request', async () => {
    let signal!: AbortSignal
    search.mockImplementationOnce((_query, _manifest, received) => {
      signal = received!
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const controller = new AbortController()
    const request = scanAsteroidCatalog({ manifest, filters: { ...DEFAULT_CATALOG_FILTERS, query: 'ceres' }, sampleLimit: 2000, signal: controller.signal })
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(signal.aborted).toBe(true)
    expect(workers).toHaveLength(0)
  })
})
