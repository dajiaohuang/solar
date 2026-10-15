import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CHUNK_CACHE_ENTRIES,
  MAX_LOOKUP_CACHE_ENTRIES,
  loadAsteroidBodiesByIds,
  loadAsteroidRecordsByLocators,
  loadAsteroidSectionPage,
  loadAsteroidSectionPreviousPage,
  loadDatasetProvenance,
  loadAsteroidChunk,
  loadAsteroidManifest,
  loadAsteroidSearchBucket,
  loadAsteroidSample,
  resetDatasetLoader,
  searchAsteroidCatalogPage,
} from '../../src/lib/catalogLoader'
import type { AsteroidIndexEntry, AsteroidManifest } from '../../src/types'

const manifest: AsteroidManifest = {
  schemaVersion: 2,
  version: 'mpcorb-current-full',
  datasetMode: 'full',
  source: 'fixture',
  generatedAt: '2026-08-19T00:00:00Z',
  totalCount: 0,
  chunkCount: 9,
  chunkSize: 5_000,
  format: 'binary-v1',
  bucketCounts: {},
  categoryCounts: {},
  featured: [],
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  resetDatasetLoader()
  vi.unstubAllGlobals()
})

describe('catalog loader cache isolation', () => {
  const entry: AsteroidIndexEntry = {
    id: 'asteroid:1', label: 'Alpha', shortLabel: 'Alpha', searchKey: 'alpha', chunkId: 'chunk-0000',
    orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', isNeo: false, isPha: false,
  }

  it('cancels prefix search without starting legacy fallbacks', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal
      requestSignal?.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const request = loadAsteroidSearchBucket('prefix-ce', manifest, controller.signal)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    controller.abort()
    await rejected
    await vi.waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares decoded shard work while one owner cancels, then aborts both paired reads for the last owner', async () => {
    const requests: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!
      requests.push(signal)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })))
    const a = new AbortController(), b = new AbortController()
    const first = loadAsteroidChunk('owned', manifest, a.signal), second = loadAsteroidChunk('owned', manifest, b.signal)
    const rejected = [expect(first).rejects.toMatchObject({ name: 'AbortError' }), expect(second).rejects.toMatchObject({ name: 'AbortError' })]
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    a.abort()
    await rejected[0]
    expect(requests.every(signal => !signal.aborted)).toBe(true)
    b.abort()
    await rejected[1]
    await vi.waitFor(() => expect(requests.every(signal => signal.aborted)).toBe(true))
  })

  it('stops sibling shard metadata when binary validation fails', async () => {
    let metadataSignal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('.bin')) return Promise.resolve(new Response(new Float64Array([2451545, 2, NaN, 0, 0, 0, 0, 1])))
      metadataSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => metadataSignal!.addEventListener('abort', () => reject(metadataSignal!.reason), { once: true }))
    }))
    await expect(loadAsteroidChunk('invalid-pair', manifest)).rejects.toThrow('Non-finite')
    await vi.waitFor(() => expect(metadataSignal?.aborted).toBe(true))
  })

  it('keeps pending search and provenance bound to the release where they began', async () => {
    let finishSearch!: (response: Response) => void
    let finishProvenance!: (response: Response) => void
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/manifest.json')) return json({ ...manifest, version: url.includes('/old/') ? 'old' : 'new' })
      if (url.endsWith('/search/a.json')) return new Promise<Response>(resolve => { finishSearch = resolve })
      if (url.endsWith('/provenance.json')) return new Promise<Response>(resolve => { finishProvenance = resolve })
      if (url.includes('/meta/')) return json([entry])
      if (url.includes('/binary/')) return new Response(new Float64Array([2451545, 2.5, .1, 5, 10, 20, 30, .25]))
      return new Response(null, { status: 404 })
    }))
    await loadAsteroidManifest('old')
    const search = searchAsteroidCatalogPage({ query: 'alpha' })
    const provenance = loadDatasetProvenance()
    await vi.waitFor(() => expect(finishSearch && finishProvenance).toBeTypeOf('function'))
    await loadAsteroidManifest('new')
    finishSearch(json([entry]))
    finishProvenance(new Response(null, { status: 404 }))
    expect((await search).records[0].id).toBe(entry.id)
    expect((await provenance)?.datasetVersion).toBe('old')
    expect(requests.filter(url => /\/(meta|binary)\//.test(url)).every(url => url.includes('/old/'))).toBe(true)
  })

  it('hydrates explicit locators and both page directions from their own manifest', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/manifest.json')) return json(manifest)
      if (url.includes('/meta/')) return json([entry])
      if (url.includes('/binary/')) return new Response(new Float64Array([2451545, 2.5, .1, 5, 10, 20, 30, .25]))
      return new Response(null, { status: 404 })
    }))
    await loadAsteroidManifest('new')
    const old = { ...manifest, releasePath: '/old', chunkCount: 1 }
    expect((await loadAsteroidRecordsByLocators(old, new Uint32Array([0, 0])))[0].id).toBe(entry.id)
    expect((await loadAsteroidSectionPage({ manifest: old, orbitClassCode: 'all', pageSize: 1 })).records).toHaveLength(1)
    expect((await loadAsteroidSectionPreviousPage({ manifest: old, orbitClassCode: 'all', pageSize: 1, cursor: { chunkIndex: 1, recordOffset: 0 } })).records).toHaveLength(1)
    expect(requests.filter(url => /\/(meta|binary)\//.test(url)).every(url => url.startsWith('/old/'))).toBe(true)
    expect((await loadAsteroidSectionPreviousPage({ manifest: { ...old, chunkCount: 0 }, orbitClassCode: 'all', pageSize: 1, cursor: { chunkIndex: 0, recordOffset: 0 } })).records).toEqual([])
    expect(requests.some(url => url.includes('chunk-00-1'))).toBe(false)
  })

  it('retries failed ID lookup and bounds lookup buckets while preserving requested order', async () => {
    let fail = true
    const lookups: string[] = []
    const entries = Array.from({ length: 20 }, (_, index) => ({ ...entry, id: `asteroid:${index}` }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/manifest.json')) return json(manifest)
      if (url.includes('/lookup/')) {
        lookups.push(url)
        // Fixture lookup files use the producer's FNV-1a low-byte partition.
        const bucket = url.split('/').at(-1)!.replace('.json', '')
        return fail ? new Response(null, { status: 503 }) : json(entries.filter(record => {
          let hash = 0x811c9dc5
          for (const char of record.id) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
          return (hash >>> 0).toString(16).slice(-2).padStart(2, '0') === bucket
        }))
      }
      if (url.includes('/meta/')) return json(entries)
      if (url.includes('/binary/')) return new Response(new Float64Array(entries.flatMap(() => [2451545, 2.5, .1, 5, 10, 20, 30, .25])))
      return new Response(null, { status: 404 })
    }))
    await loadAsteroidManifest('mpcorb-current-full')
    await expect(loadAsteroidBodiesByIds(['asteroid:0'])).rejects.toThrow('503')
    fail = false
    expect((await loadAsteroidBodiesByIds(['asteroid:0']))[0].id).toBe('asteroid:0')
    for (let index = 1; index <= MAX_LOOKUP_CACHE_ENTRIES + 1; index++) await loadAsteroidBodiesByIds([`asteroid:${index}`])
    await loadAsteroidBodiesByIds(['asteroid:0'])
    expect(lookups.filter(url => url === lookups[0])).toHaveLength(3)
    expect((await loadAsteroidBodiesByIds(['asteroid:9', 'asteroid:2', 'asteroid:1'])).map(body => body.id)).toEqual(['asteroid:9', 'asteroid:2', 'asteroid:1'])
  })

  it('retries a failed search instead of caching a network error as zero matches', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/manifest.json')) return json(manifest)
      return fail ? new Response(null, { status: 503 }) : json([])
    }))
    await loadAsteroidManifest('mpcorb-current-full')
    await expect(loadAsteroidSearchBucket('a')).rejects.toThrow('503')
    fail = false
    await expect(loadAsteroidSearchBucket('a')).resolves.toEqual([])
  })

  it('rejects non-finite binary elements and permits retry after recovery', async () => {
    let corrupt = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/manifest.json')) return json(manifest)
      if (url.endsWith('.json')) return json([entry])
      return new Response(new Float64Array([2451545, 2, .1, corrupt ? NaN : 0, 0, 0, 0, 1]))
    }))
    await loadAsteroidManifest('mpcorb-current-full')
    await expect(loadAsteroidChunk('chunk-0000')).rejects.toThrow('Non-finite')
    corrupt = false
    await expect(loadAsteroidChunk('chunk-0000')).resolves.toHaveLength(1)
  })
  it('does not let a missing requested version poison the current manifest promise', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/releases/missing-version/')) return new Response(null, { status: 404 })
      if (url.endsWith('/dataset-version.json')) return json({ schemaVersion: 1, activeVersion: manifest.version,
        mode: manifest.datasetMode, manifestPath: 'releases/mpcorb-current-full/manifest.json' })
      if (url.endsWith('/releases/mpcorb-current-full/manifest.json')) return json(manifest)
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await loadAsteroidManifest('missing-version')).toBeNull()
    expect((await loadAsteroidManifest())?.version).toBe('mpcorb-current-full')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/dataset-version.json'))).toBe(true)
  })

  it('evicts decoded chunks beyond the bounded LRU capacity', async () => {
    const chunkRequests = new Map<string, number>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/releases/mpcorb-current-full/manifest.json')) return json(manifest)
      const metadata = url.match(/\/meta\/(chunk-\d{4})\.json$/)
      if (metadata) {
        chunkRequests.set(metadata[1], (chunkRequests.get(metadata[1]) ?? 0) + 1)
        return json([])
      }
      if (/\/binary\/chunk-\d{4}\.bin$/.test(url)) return new Response(new ArrayBuffer(0))
      return new Response(null, { status: 404 })
    }))

    await loadAsteroidManifest('mpcorb-current-full')
    for (let index = 0; index <= MAX_CHUNK_CACHE_ENTRIES; index += 1) {
      await loadAsteroidChunk(`chunk-${String(index).padStart(4, '0')}`)
    }
    await loadAsteroidChunk('chunk-0000')
    expect(chunkRequests.get('chunk-0000')).toBe(2)
  })

  it('returns total, loaded records, and a cursor instead of silently truncating search', async () => {
    const entries: AsteroidIndexEntry[] = Array.from({ length: 3 }, (_, index) => ({
      id: `asteroid:${index}`,
      label: `Alpha ${index}`,
      shortLabel: `${index}`,
      searchKey: `alpha ${index}`,
      chunkId: `chunk-${String(index).padStart(4, '0')}`,
      orbitClassCode: 'MBA',
      orbitClassName: 'Main-belt Asteroid',
      isNeo: false,
      isPha: false,
    }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/releases/mpcorb-current-full/manifest.json')) return json(manifest)
      if (url.endsWith('/search/a.json')) return json(entries)
      const metadata = url.match(/\/meta\/(chunk-\d{4})\.json$/)
      if (metadata) return json(entries.filter((entry) => entry.chunkId === metadata[1]))
      if (/\/binary\/chunk-\d{4}\.bin$/.test(url)) {
        return new Response(new Float64Array([2_460_000.5, 2.5, 0.1, 5, 10, 20, 30, 0.25]))
      }
      return new Response(null, { status: 404 })
    }))

    await loadAsteroidManifest('mpcorb-current-full')
    const first = await searchAsteroidCatalogPage({ query: 'alpha', maximumChunks: 1 })
    expect(first).toMatchObject({ total: 3, nextCursor: 1 })
    expect(first.records.map((record) => record.id)).toEqual(['asteroid:0'])
    const second = await searchAsteroidCatalogPage({ query: 'alpha', cursor: first.nextCursor!, maximumChunks: 1 })
    expect(second).toMatchObject({ total: 3, nextCursor: 2 })
    expect(second.records.map((record) => record.id)).toEqual(['asteroid:1'])
  })

  it('isolates sample profiles and rejects artifact counts that disagree with the manifest', async () => {
    const sampleManifest: AsteroidManifest = {
      ...manifest,
      version: 'mpcorb-samples-full',
      releasePath: '/samples',
      precomputedSamples: {
        desktop: { metadataPath: 'desktop.json', binaryPath: 'desktop.bin', count: 1 },
        mobile: { metadataPath: 'mobile.json', binaryPath: 'mobile.bin', count: 1 },
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const profile = url.includes('mobile') ? 'mobile' : 'desktop'
      if (url.endsWith('.json')) return json([{
        id: `asteroid:${profile}`, label: profile, shortLabel: profile, searchKey: profile, chunkId: 'chunk-0000',
        orbitClassCode: 'MBA', orbitClassName: 'Main-belt Asteroid', isNeo: false, isPha: false,
      }])
      if (url.endsWith('.bin')) return new Response(new Float64Array([2451545, 2.5, 0.1, 5, 10, 20, 30, 0.25]))
      return new Response(null, { status: 404 })
    }))

    expect((await loadAsteroidSample(sampleManifest, 'desktop'))[0].id).toBe('asteroid:desktop')
    expect((await loadAsteroidSample(sampleManifest, 'mobile'))[0].id).toBe('asteroid:mobile')
    await expect(loadAsteroidSample({
      ...sampleManifest,
      version: 'mpcorb-bad-sample-full',
      precomputedSamples: {
        ...sampleManifest.precomputedSamples!,
        mobile: { ...sampleManifest.precomputedSamples!.mobile, count: 2 },
      },
    }, 'mobile')).rejects.toThrow('does not match its manifest count')
  })
})
