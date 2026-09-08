import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const android = readFileSync(new URL('../../android/app/src/main/java/io/github/dajiaohuang/solaratlas/MainActivity.java', import.meta.url), 'utf8')
const ios = readFileSync(new URL('../../ios/App/App/NativeObservationDeck.swift', import.meta.url), 'utf8')

const presetIds = ['planets', 'earth-moon', 'mars-moons', 'jupiter-moons', 'saturn-moons', 'uranus-moons', 'neptune-moons', 'pluto-moons', 'spk-asteroids']
const sourceIds = [
  'naif:10', 'naif:199', 'naif:299', 'naif:301', 'naif:399', 'naif:499', 'naif:401', 'naif:402',
  'naif:599', 'naif:501', 'naif:502', 'naif:503', 'naif:504', 'naif:505', 'naif:514', 'naif:515', 'naif:516',
  'naif:699', 'naif:601', 'naif:602', 'naif:603', 'naif:604', 'naif:605', 'naif:606', 'naif:607', 'naif:608', 'naif:609', 'naif:612', 'naif:613', 'naif:614', 'naif:632', 'naif:634',
  'naif:799', 'naif:701', 'naif:702', 'naif:703', 'naif:704', 'naif:705', 'naif:899', 'naif:801', 'naif:802',
  'naif:999', 'naif:901', 'naif:902', 'naif:903', 'naif:904', 'naif:905',
  'asteroid:2', 'asteroid:3', 'asteroid:4', 'asteroid:7', 'asteroid:10', 'asteroid:15', 'asteroid:16', 'asteroid:31', 'asteroid:52', 'asteroid:65', 'asteroid:87', 'asteroid:88', 'asteroid:107', 'asteroid:511', 'asteroid:704',
]

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
  })
})
