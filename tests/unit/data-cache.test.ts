import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { datasetVersionFromUrl, isObsoleteDatasetVersion, parseMaybeGzipJson } from '../../src/data/cache/indexedDb'

describe('versioned dataset persistence', () => {
  it('derives an immutable release version from encoded data URLs', () => {
    expect(datasetVersionFromUrl('/solar/data/asteroids/releases/mpcorb-abc-full/meta/chunk-0001.json'))
      .toBe('mpcorb-abc-full')
    expect(datasetVersionFromUrl('/solar/data/asteroids/dataset-version.json')).toBe('legacy')
  })

  it('includes both preview availability and source release in cache identity', () => {
    const hash = 'a'.repeat(64)
    expect(datasetVersionFromUrl(`/solar/data/asteroids/preview/${hash}/releases/v%201/sample.bin`))
      .toBe(`preview:${hash}:v 1`)
    expect(datasetVersionFromUrl(`/solar/data/asteroids/preview/${'b'.repeat(64)}/releases/v%201/sample.bin`))
      .not.toBe(`preview:${hash}:v 1`)
    expect(datasetVersionFromUrl(`/solar/data/asteroids/preview/${hash}/releases/v2/sample.bin`))
      .not.toBe(`preview:${hash}:v 1`)
  })

  it('evicts obsolete releases only within the active product namespace', () => {
    const preview = `preview:${'a'.repeat(64)}:v1`
    const nextPreview = `preview:${'b'.repeat(64)}:v1`
    expect(isObsoleteDatasetVersion('v1', 'v2')).toBe(true)
    expect(isObsoleteDatasetVersion(preview, nextPreview)).toBe(true)
    expect(isObsoleteDatasetVersion(preview, preview)).toBe(false)
    expect(isObsoleteDatasetVersion('v1', preview)).toBe(false)
    expect(isObsoleteDatasetVersion(preview, 'v2')).toBe(false)
    expect(isObsoleteDatasetVersion('legacy', preview)).toBe(true)
    expect(isObsoleteDatasetVersion('v1', 'legacy')).toBe(false)
    expect(isObsoleteDatasetVersion(preview, 'legacy')).toBe(false)
  })

  it('keeps release data out of Cache Storage and scopes cache cleanup to Solar Atlas', async () => {
    const source = await readFile(resolve('public/sw.js'), 'utf8')
    expect(source).toContain("key.startsWith(OWN_PREFIX)")
    expect(source).toContain("url.pathname.includes('/data/asteroids/')")
    expect(source).not.toContain('caches.open(IMMUTABLE_DATA_CACHE)')
  })

  it('refreshes IndexedDB LRU access time when cached data is read', async () => {
    const source = await readFile(resolve('src/data/cache/indexedDb.ts'), 'utf8')
    expect(source).toContain("database.transaction(STORE_NAME, 'readwrite')")
    expect(source).toContain('store.put({ ...request.result, lastAccessed: Date.now() }')
  })

  it('accepts both raw gzip bytes and host-decoded JSON responses', async () => {
    const value = { version: 'fixture', count: 3 }
    const plain = new TextEncoder().encode(JSON.stringify(value))
    const gzipped = gzipSync(plain)
    const gzipBuffer = gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength)
    expect(await parseMaybeGzipJson(gzipBuffer)).toEqual(value)
    expect(await parseMaybeGzipJson(plain.buffer)).toEqual(value)
  })
})
