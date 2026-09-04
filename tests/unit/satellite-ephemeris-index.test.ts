import { describe, expect, it } from 'vitest'

const { parseSatelliteEphemerisIndex, reconcileSatelliteIdentities } = await import('../../scripts/lib/satellite-ephemeris-index.mjs')

const fixture = `
<table id="sat_ephem"><thead><tr><th>Planet</th><th>Satellite</th><th>Code</th><th>Ephemeris</th><th>Ref</th></tr></thead>
<tbody><tr><td>Mars</td><td>Phobos</td><td>401</td><td><a href="#MAR099">view</a></td><td>JPL &amp; ESA</td></tr>
<tr><td>Jupiter</td><td>S/2010 J3</td><td>505</td><td><a href="#JUP505">view</a></td><td>JPL</td></tr></tbody></table>
<div id="MAR099"><p>Start: 1900-01-01</p><p>Stop: 2100-01-01</p><p>DataFile: <a href="/home/sat/ MAR099.bsp">MAR099.bsp</a></p><p>Reference: <a href="https://ssd.jpl.nasa.gov">JPL</a></p></div>
<div id="JUP505"><p>Start: 1950-01-01</p><p>Stop: 2050-01-01</p><p>DataFile: <a href="/home/sat/JUP505.bsp">JUP505.bsp</a></p><p>Reference: JPL</p></div>`

describe('parseSatelliteEphemerisIndex', () => {
  it('parses rows, parents, entities and raw source URLs', () => {
    const result = parseSatelliteEphemerisIndex(fixture)
    expect(result.bodies).toEqual([
      { naifId: 401, name: 'Phobos', parentId: 'mars', parentNaifId: 499, ephemeris: 'MAR099', reference: 'JPL & ESA' },
      { naifId: 505, name: 'S/2010 J3', parentId: 'jupiter', parentNaifId: 599, ephemeris: 'JUP505', reference: 'JPL' },
    ])
    expect(result.sources[0]).toMatchObject({ id: 'MAR099', url: '/home/sat/ MAR099.bsp', from: '1900-01-01', to: '2100-01-01' })
  })

  it('rejects fabricated or ambiguous identity inputs', () => {
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('401', '401').replace('505', '401'))).toThrow(/Duplicate/)
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('#MAR099', '#MISSING'))).toThrow(/Unlinked/)
  })
})

describe('reconcileSatelliteIdentities', () => {
  it('matches exact normalized provisional aliases and preserves failures', () => {
    const result = reconcileSatelliteIdentities([
      { id: 'a', name: 'S/2010 J3', parentId: 'naif:599' },
      { id: 'b', name: 'Phobos', parentId: 'mars' },
      { id: 'c', name: 'S/2010 J4', parentId: 'naif:599' },
    ], [
      { naifId: 505, name: 'S/2010_J3', parentId: 'jupiter', parentNaifId: 599 },
      { naifId: 401, name: 'Phobos', parentId: 'mars', parentNaifId: 499 },
    ])
    expect(result.matched).toHaveLength(2)
    expect(result.unmatched[0].reason).toMatch(/exact normalized name and parent/)
    expect(result.ambiguous).toHaveLength(0)
  })
})
