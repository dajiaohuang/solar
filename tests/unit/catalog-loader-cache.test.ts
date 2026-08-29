import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CHUNK_CACHE_ENTRIES,
  loadAsteroidChunk,
  loadAsteroidManifest,
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
  it('does not let a missing requested version poison the current manifest promise', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/releases/missing-version/')) return new Response(null, { status: 404 })
      if (url.endsWith('/dataset-version.json')) return json({ manifestPath: 'releases/mpcorb-current-full/manifest.json' })
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
