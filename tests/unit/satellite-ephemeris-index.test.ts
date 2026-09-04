import { describe, expect, it } from 'vitest'

const { parseSatelliteEphemerisIndex, parseSatelliteKernelIdentities, reconcileSatelliteIdentities } = await import('../../scripts/lib/satellite-ephemeris-index.mjs')

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
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('505', '401'))).toThrow(/parent mismatch/)
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('#MAR099', '#MISSING'))).toThrow(/Unlinked/)
  })
  it('rejects impossible dates, malformed rows and repeated source IDs', () => {
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('1900-01-01', '1900-02-30'))).toThrow(/bounds/)
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('<td>401</td>', ''))).toThrow(/row/)
    expect(() => parseSatelliteEphemerisIndex(fixture + '<div id="MAR099"></div>')).toThrow(/Duplicate/)
    expect(() => parseSatelliteEphemerisIndex(fixture.replace('Jupiter', 'Uranus'))).toThrow(/parent mismatch/)
  })
  it('retains alternate solution assignments without treating first row as precedence', () => {
    const duplicate = '<tr><td>Mars</td><td>Phobos</td><td>401</td><td><a href="#JUP505">alternate</a></td><td>Other source</td></tr>'
    const result = parseSatelliteEphemerisIndex(fixture.replace('</tbody>', `${duplicate}</tbody>`))
    expect(result.bodies).toHaveLength(2)
    expect(result.bodies[0].sourceAssignments).toEqual([{ ephemeris: 'MAR099', reference: 'JPL & ESA' }, { ephemeris: 'JUP505', reference: 'Other source' }])
  })
})

describe('reconcileSatelliteIdentities', () => {
  it('requires a unique explicit merge target, named rock and matching parent descriptor for ROCKSPK identities', () => {
    const comments = `; BEGIN SPKMERGE COMMANDS
 SOURCE_SPK_KERNEL = sat480.bsp
 INCLUDE_COMMENTS = YES
 BODIES = 65304
 SOURCE_SPK_KERNEL = sat441l.bsp
 INCLUDE_COMMENTS = NO
 BODIES = 699
; END SPKMERGE COMMANDS
 Rock Elements: SAT480
 Bodies on the File:
 Name Number GM AX BX CX
 S/2009_s_2 *** 0.0E+00 0.000 0.000 0.000
 Elements for S/2009_s_2 at Julian Date: 2454888.5260157059 Center: SATURN`
    const segments = [{ target: 65304, center: 699, type: 17 }, { target: 699, center: 6, type: 2 }]
    expect(parseSatelliteKernelIdentities(comments, segments, 'SAT480')).toMatchObject([{ naifId: 65304, name: 'S/2009_s_2', parentId: 'saturn' }])
    expect(parseSatelliteKernelIdentities(comments, segments, 'sat480')).toMatchObject([{ naifId: 65304 }])
    for (const changed of [comments.replace('BODIES = 65304', 'BODIES = 65304, 65305'), comments.replace('INCLUDE_COMMENTS = NO', 'INCLUDE_COMMENTS = YES'), comments.replace('Center: SATURN', 'Center: JUPITER'), comments.replace('sat480.bsp', 'another.bsp'), comments + '\n Elements for other at Julian Date: 2454888 Center: SATURN']) {
      expect(parseSatelliteKernelIdentities(changed, segments, 'SAT480')).toEqual([])
    }
    expect(parseSatelliteKernelIdentities(comments, [{ ...segments[0], target: 65305 }], 'SAT480')).toEqual([])
  })
  it('normalizes source separators and zero padding but never merges distinct designations or parents', () => {
    const discovery = [
      { name: 'S/2003 J2', parentId: 'jupiter' },
      { name: 'S/2023 S1', parentId: 'saturn' },
    ]
    const candidates = [
      { naifId: 55501, name: 'S2003_j_2', parentId: 'jupiter' },
      { naifId: 65236, name: 'S2023_s01', parentId: 'saturn' },
      { naifId: 65237, name: 'S2023_s02', parentId: 'saturn' },
      { naifId: 55502, name: 'S2003_j_2', parentId: 'saturn' },
    ]
    expect(reconcileSatelliteIdentities(discovery, candidates).matched.map(row => row.body.naifId)).toEqual([55501, 65236])
  })
  it('retains conflicting published IDs instead of letting source order resolve them', () => {
    const discovery = [{ name: 'Francisco', parentId: 'uranus' }]
    const candidates = [
      { name: 'Francisco', parentId: 'uranus', naifId: 723, ephemeris: 'table' },
      { name: 'Francisco', parentId: 'uranus', naifId: 722, ephemeris: 'comments' },
    ]
    const result = reconcileSatelliteIdentities(discovery, candidates)
    expect(result.matched).toHaveLength(0)
    expect(result.ambiguous[0].sourceMatches).toEqual(candidates)
    expect(reconcileSatelliteIdentities(discovery, [...candidates].reverse()).ambiguous).toHaveLength(1)
  })
  it('reads explicit names and model parameters only when SPK descriptors confirm the number', () => {
    const comments = 'Planet Name: Jupiter\nBodies on the File:\n Name Number GM NDIV NDEG Model\n Himalia 506 1.515E-01 1 15 SATORBINT\n Elara 507 0.0E+00 1 15 SATORBINT\n Unknown 508 0.0E+00 1 15 SATORBINT\nAdditional Constants on the File:\n'
    const bodies = parseSatelliteKernelIdentities(comments, [{ target: 506 }, { target: 507 }], 'JUP347')
    expect(bodies.map(body => body.naifId)).toEqual([506, 507])
    expect(bodies[1]).toMatchObject({ name: 'Elara', parentNaifId: 599, sourceModelGmKm3S2: '0.0E+00' })
    expect(bodies[1].sourceModelGmBoundary).toContain('not asserted measured')
  })
  it('matches Saturn/Uranus/Neptune/Pluto provisional spellings and Pluto discovery parent', () => {
    for (const [parentId, parentNaifId, letter] of [['saturn', 699, 'S'], ['uranus', 799, 'U'], ['neptune', 899, 'N'], ['pluto', 999, 'P']] as const) {
      const sourceParent = parentId === 'pluto' ? 'sb:asteroid:134340' : `naif:${parentNaifId}`
      const result = reconcileSatelliteIdentities([{ parentId: sourceParent, name: `S/2020 ${letter}1` }], [{ parentId, parentNaifId, name: `S2020_${letter}1` }])
      expect(result.matched).toHaveLength(1)
    }
  })
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
