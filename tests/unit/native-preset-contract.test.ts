import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const android = readFileSync(new URL('../../android/app/src/main/java/io/github/dajiaohuang/solaratlas/MainActivity.java', import.meta.url), 'utf8')
const ios = readFileSync(new URL('../../ios/App/App/NativeObservationDeck.swift', import.meta.url), 'utf8')
const ephemerisBodies = JSON.parse(readFileSync(new URL('../../src/data/ephemerisBodies.json', import.meta.url), 'utf8')) as { bodies: Array<{ id: string }> }

const presetIds = ['planets', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto-moons', 'spk-asteroids']
const sourceIds = ephemerisBodies.bodies.map(body => body.id)
const asteroidIds = sourceIds.filter(id => id.startsWith('asteroid:'))
const asteroidPresetLine = (source: string) => source.split('\n').find(line => line.includes('spk-asteroids')) ?? ''
const asteroidPresetIds = (source: string) => asteroidPresetLine(source).match(/asteroid:\d+/g) ?? []

describe('native preset parity', () => {
  it('keeps Android and iOS preset identities aligned with the packaged source targets', () => {
    expect(android.match(/new Preset\(/g)).toHaveLength(presetIds.length)
    expect(ios.match(/\.init\(id:/g)).toHaveLength(presetIds.length)
    for (const id of presetIds) {
      expect(android).toContain(`new Preset("${id}"`)
      expect(ios).toContain(`.init(id: "${id}"`)
    }
    for (const id of sourceIds) {
      expect(android).toContain(id)
      expect(ios).toContain(id)
    }
    // The asteroid preset is the native entry point for every packaged
    // asteroid identity; keep its static lists aligned with the source file.
    for (const id of asteroidIds) {
      expect(asteroidPresetLine(android)).toContain(id)
      expect(asteroidPresetLine(ios)).toContain(id)
    }
    expect(asteroidPresetIds(android)).toEqual(asteroidIds)
    expect(asteroidPresetIds(ios)).toEqual(asteroidIds)
  })
})
