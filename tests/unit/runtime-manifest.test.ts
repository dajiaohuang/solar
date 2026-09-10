import { describe, expect, it } from 'vitest'
import full from '../../src/data/ephemeris-manifest-full.json'
import pages from '../../src/data/ephemeris-manifest.json'
import { runtimeEphemerisManifest } from '../../src/engine/ephemeris/runtimeManifest'

describe('runtime ephemeris execution index', () => {
  it.each([full, pages])('preserves all execution fields and source links in $profile order', source => {
    const runtime = runtimeEphemerisManifest(source)
    expect(runtime.id).toBe(source.id)
    expect(runtime.files).toHaveLength(source.files.length)
    for (let index = 0; index < source.files.length; index++) {
      for (const [key, value] of Object.entries(runtime.files[index])) {
        expect(value).toEqual(source.files[index][key as keyof typeof source.files[number]])
      }
    }
    expect(JSON.stringify(runtime).length).toBeLessThan(JSON.stringify(source).length * .6)
    expect(source.files.some(file => file.sourceIdentity)).toBe(true)
  })
})
