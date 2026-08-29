import { describe, expect, it } from 'vitest'
import { localizeSavedSceneUrl, mergeSceneLibrary, parseSceneLibrary, persistSavedScenes, sceneLibraryDocument, type SavedScene } from '../../src/lib/sceneLibrary'

function memoryStorage() {
  let value: string | null = null
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next } }
}

const scene: SavedScene = {
  schemaVersion: 1, id: 'scene-1', title: 'Mars', notes: 'Geocentric loop', url: 'https://example.test/solar/?v=3&page=explorer',
  datasetVersion: 'fixture-full', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
}

describe('local scene library', () => {
  it('accepts the versioned export envelope and rejects malformed entries', () => {
    expect(parseSceneLibrary(JSON.stringify({ schemaVersion: 1, scenes: [scene] }))).toEqual([scene])
    expect(() => parseSceneLibrary(JSON.stringify({ scenes: [{ ...scene, schemaVersion: 99 }] }))).toThrow()
    expect(() => parseSceneLibrary(JSON.stringify({ schemaVersion: 99, scenes: [scene] }))).toThrow(/version/i)
    expect(() => parseSceneLibrary(JSON.stringify({ schemaVersion: 1, scenes: [{ ...scene, url: 'javascript:alert(1)' }] }))).toThrow()
  })

  it('merges imported scenes by stable id', () => {
    const storage = memoryStorage()
    persistSavedScenes([scene], storage)
    const merged = mergeSceneLibrary([{ ...scene, title: 'Updated', updatedAt: '2026-08-21T00:00:00.000Z' }], storage)
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('Updated')
  })

  it('opens an imported scene on the current deployment origin and base path', () => {
    expect(localizeSavedSceneUrl(
      'https://dajiaohuang.github.io/solar/?v=3&page=events#result',
      'http://127.0.0.1:4173/solar/?v=3&page=home',
    )).toBe('http://127.0.0.1:4173/solar/?v=3&page=events#result')
  })

  it('exports the planetary model identity and Earth point representation with the scene URLs', () => {
    const document = JSON.parse(sceneLibraryDocument([scene]))
    expect(document.evidence.planetaryApproximation).toMatchObject({
      id: 'jpl-approx-table-1',
      validFrom: '1800-01-01',
      validTo: '2050-12-31',
      earthPoint: 'earth-moon-barycenter',
    })
    expect(parseSceneLibrary(JSON.stringify(document))).toEqual([scene])
  })
})
