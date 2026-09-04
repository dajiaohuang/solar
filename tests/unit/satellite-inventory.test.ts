import { describe, expect, it } from 'vitest'
import { parsePlanetarySatellites, parseSmallBodySatellites } from '../../scripts/lib/satellite-inventory.mjs'

const html = `A total of 1 planetary satellites
<table class="sat-discovery table"><thead><tr><th>IAU</th></tr></thead><tbody>
<tr><td colspan="6">Satellites of Dwarf Planet Pluto: 1</td></tr>
<tr><td>I</td><td>Charon</td><td>S/1978 P1</td><td>1978</td><td>Christy &amp; Harrington</td><td>IAU WGPSN</td></tr>
</tbody></table>`
const signature = { source: 'NASA/JPL Small-Body Satellites API', version: '1.0' }
const sat = { pdes: '45', kind: 'an', confirmed: 'Y', iau_num: '1', iau_name: 'Petit-Prince', sat_fullname: '(45) Eugenia I Petit-Prince', ref: 'Source reference' }
describe('all-body satellite source inventory', () => {
  it('retains planetary parent identity and discovery evidence, not invented orbits', () => {
    const result = parsePlanetarySatellites(html)
    expect(result.records[0]).toMatchObject({ parentId: 'sb:asteroid:134340', name: 'Charon', geometryStatus: 'missing-elements', sourceRef: { discoverers: 'Christy & Harrington' } })
    expect(result.records[0].orbit).toBeUndefined()
  })
  it('rejects changed totals, groups and malformed rows', () => {
    expect(() => parsePlanetarySatellites(html.replace('total of 1', 'total of 2'))).toThrow('count mismatch')
    expect(() => parsePlanetarySatellites(html.replace('Pluto: 1', 'Pluto: 2'))).toThrow('count mismatch')
    expect(() => parsePlanetarySatellites(html.replace('<td>I</td>', ''))).toThrow('row')
    expect(() => parsePlanetarySatellites(html.replace('Pluto: 1', 'Unknown: 1'))).toThrow('group')
  })
  it('keeps missing satellite data and candidate confirmation explicit', () => {
    const records = parseSmallBodySatellites({ signature, count: 1, data: [{ sat: { ...sat, confirmed: 'N' }, orbit: { per: '~38', epoch: null } }] })
    expect(records[0]).toMatchObject({ confirmation: 'candidate', parentId: 'sb:asteroid:45', geometryStatus: 'unvalidated-satellite-elements', orbitEvidence: { per: '~38', epoch: null }, physicalEvidence: null })
  })
  it('does not collapse unnamed components with identical discovery metadata', () => {
    const anonymous = { ...sat, iau_num: null, iau_name: '', sat_fullname: null }
    const records = parseSmallBodySatellites({ signature, count: 2, data: [{ sat: anonymous }, { sat: anonymous }] })
    expect(records[0].identityStatus).toBe('unresolved-component')
    expect(records[0].id).not.toBe(records[1].id)
    expect(records[0].geometryStatus).toBe('missing-elements')
  })
  it('rejects duplicate resolved identities, invalid signatures and lost rows', () => {
    expect(() => parseSmallBodySatellites({ signature, count: 2, data: [{ sat }, { sat }] })).toThrow('Duplicate')
    expect(() => parseSmallBodySatellites({ signature: { ...signature, version: '2' }, count: 1, data: [{ sat }] })).toThrow('signature')
    expect(() => parseSmallBodySatellites({ signature, count: 2, data: [{ sat }] })).toThrow('count')
  })
})
