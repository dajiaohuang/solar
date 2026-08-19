import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { datasetVersionFromUrl } from '../../src/data/cache/indexedDb'

describe('versioned dataset persistence', () => {
  it('derives an immutable release version from encoded data URLs', () => {
    expect(datasetVersionFromUrl('/solar/data/asteroids/releases/mpcorb-abc-full/meta/chunk-0001.json'))
      .toBe('mpcorb-abc-full')
    expect(datasetVersionFromUrl('/solar/data/asteroids/dataset-version.json')).toBe('legacy')
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
})
