import { readFile } from 'node:fs/promises'
import { test, expect, vi } from 'vitest'
import { GaiaSourceCache } from '../../src/lib/gaiaCache'
import { decodeGaiaManifest, streamGaiaChunks } from '../../src/lib/gaiaChunks'

test('cache owns bytes and enforces LRU byte and entry ceilings', () => {
  const cache = new GaiaSourceCache(4,2), a='a'.repeat(64), b='b'.repeat(64), c='c'.repeat(64)
  const bytes = new Uint8Array([1,2]); cache.put(a,bytes); bytes[0]=9
  cache.put(b,new Uint8Array([3])); const copy = cache.get(a)!; copy[0]=8
  expect(cache.get(a)).toEqual(new Uint8Array([1,2]))
  cache.put(c,new Uint8Array([4,5])); expect(cache.get(b)).toBeUndefined()
  expect(cache.retainedBytes).toBe(4); expect(cache.count).toBe(2)
  cache.put(b,new Uint8Array(5)); expect(cache.get(b)).toBeUndefined()
  cache.clear(); expect(cache.retainedBytes).toBe(0); expect(cache.count).toBe(0)
})
test('verified remote source bytes are reused but selection and corrupt cache entries are rechecked', async () => {
  const root='tests/fixtures/gaia-pleiades-20260923/', manifest=decodeGaiaManifest(await readFile(root+'manifest.json'))
  const raw=await readFile(root+manifest.chunks[0].path), cache=new GaiaSourceCache()
  const fetcher=vi.fn(async () => new Response(raw,{headers:{'Content-Type':'application/json','Content-Length':String(raw.length)}}))
  const options={manifest,cache,fetcher,region:{raStartDeg:0,raEndDeg:360,decMinDeg:-90,decMaxDeg:90,epochJulianYear:2016 as const},baseUrl:'https://example.test/',signal:new AbortController().signal,onChunk:async () => {}}
  expect((await streamGaiaChunks(options)).cacheHits).toBe(0)
  expect((await streamGaiaChunks(options)).cacheHits).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1)
  const narrow=structuredClone(manifest); narrow.settings.radiusDeg=0.00001
  await expect(streamGaiaChunks({...options,manifest:narrow})).rejects.toThrow(/cone/)
  expect(fetcher).toHaveBeenCalledTimes(1)
  cache.put(manifest.chunks[0].sha256,new Uint8Array([0]))
  expect((await streamGaiaChunks(options)).cacheHits).toBe(0); expect(fetcher).toHaveBeenCalledTimes(2)
  expect(cache.retainedBytes).toBe(raw.length)
})
