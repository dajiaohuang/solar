import { describe, expect, it } from 'vitest'
import { parseNaifSatelliteRegistry, resolveSatelliteRegistryClaims } from '../../scripts/lib/satellite-registry.mjs'
import { reconcileSatelliteIdentities } from '../../scripts/lib/satellite-ephemeris-index.mjs'

describe('independent NAIF satellite identity corroboration', () => {
  it('reads explicit codes and rejects prose or non-satellite code families', () => {
    const records = parseNaifSatelliteRegistry("outside 722 'Wrong'\n<pre> 722 'FRANCISCO'\n 723 'MARGARET'\n 724 'FERDINAND'\n 799 'URANUS'\n -1 'SPACECRAFT'\n 100 'UNKNOWN'\n</pre>")
    expect(records.map(record => [record.naifId, record.name, record.parentNaifId])).toEqual([[722, 'FRANCISCO', 799], [723, 'MARGARET', 799], [724, 'FERDINAND', 799]])
    expect(() => parseNaifSatelliteRegistry('<p>722 FRANCISCO</p>')).toThrow()
  })
  it('resolves an independent registry number corroborated by descriptors while retaining raw conflict', () => {
    const discovery = [{ name: 'Francisco', parentId: 'uranus' }]
    const comments = [{ name: 'Francisco', parentId: 'uranus', parentNaifId: 799, naifId: 722, ephemeris: 'URA117' }]
    const table = { ...comments[0], naifId: 723 }
    const raw = reconcileSatelliteIdentities(discovery, [table, ...comments])
    expect(raw.ambiguous).toHaveLength(1)
    const registry = parseNaifSatelliteRegistry("<pre>722 'FRANCISCO'\n</pre>")
    const result = resolveSatelliteRegistryClaims(discovery, raw, comments, registry)
    expect(result.matched[0].body.naifId).toBe(722)
    expect(result.matched[0].originalClaims).toEqual([table, ...comments])
    expect(result.matched[0].originalStatus).toBe('ambiguous')
    expect(resolveSatelliteRegistryClaims(discovery, raw, [], registry).ambiguous).toHaveLength(1)
  })
  it('uses a published number rather than fuzzy name matching to resolve a source typo', () => {
    const discovery = [{ name: 'Megaclite', parentId: 'jupiter' }]
    const comments = [{ name: 'Magaclite', naifId: 519, parentId: 'jupiter', parentNaifId: 599, ephemeris: 'JUP347' }]
    const raw = reconcileSatelliteIdentities(discovery, comments)
    expect(raw.unmatched).toHaveLength(1)
    const registry = parseNaifSatelliteRegistry("<pre>519 'MEGACLITE'\n</pre>")
    const result = resolveSatelliteRegistryClaims(discovery, raw, comments, registry)
    expect(result.matched[0].body).toMatchObject({ name: 'Megaclite', rawSourceName: 'Magaclite', naifId: 519 })
    expect(resolveSatelliteRegistryClaims(discovery, raw, [{ ...comments[0], parentNaifId: 699 }], registry).unmatched).toHaveLength(1)
  })
})
