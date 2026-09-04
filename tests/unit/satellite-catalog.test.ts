import { describe, expect, it } from 'vitest'
import { makeSatelliteCatalog } from '../../scripts/lib/satellite-catalog.mjs'

const known = { discovery: { id: 'jupiter-1', name: 'Known', parentId: 'naif:599', aliases: ['S/2025 J1'] }, status: 'matched', resolution: 'source', body: { naifId: 55524 }, sourceMatches: [{ ephemeris: 'JUP347' }] }
const missing = { discovery: { id: 'saturn-unknown', name: 'Unknown', parentId: 'naif:699' }, status: 'unmatched', resolution: 'no-match' }
const comment = { name: 'Additional', naifId: 55525, parentId: 'jupiter', parentNaifId: 599, ephemeris: 'JUP347', identityEvidence: 'source-comment-name-number-matched-to-descriptor' }
const report = { registry: [], resolvedIdentities: { records: [known, missing] }, commentBodies: [comment, comment] }
describe('complete satellite identity catalog', () => {
  it('retains unresolved discovery identities and additional original-kernel identities without invented physics', () => {
    const bodies = makeSatelliteCatalog(report)
    expect(bodies).toHaveLength(3)
    expect(bodies.find(body => body.id === 'saturn-unknown')).not.toHaveProperty('naifId')
    expect(bodies.find(body => body.naifId === 55525)?.identityStatus).toBe('source-identified-not-in-discovery-snapshot')
    for (const body of bodies) {
      for (const field of ['orbit', 'radiusKm', 'massKg', 'gm']) expect(body).not.toHaveProperty(field)
    }
  })
  it('rejects unresolved duplication rather than double-counting the same target', () => {
    expect(() => makeSatelliteCatalog({ ...report, resolvedIdentities: { records: [known, known] } })).toThrow('Duplicate')
    expect(() => makeSatelliteCatalog({ ...report, registry: undefined })).toThrow('corroborated')
    expect(() => makeSatelliteCatalog({ ...report, resolvedIdentities: { records: [{ ...missing, discovery: { ...missing.discovery, parentId: 'unknown' } }] } })).toThrow('parent')
  })
  it('retains all source claims without adopting a conflicting raw spelling as an alias', () => {
    const claims = [comment, { ...comment, name: 'Conflicting', ephemeris: 'JUP348' }]
    const body = makeSatelliteCatalog({ ...report, commentBodies: claims }).find(body => body.naifId === comment.naifId)
    expect(body).toMatchObject({ name: `NAIF ${comment.naifId}`, sourceEphemerides: ['JUP347', 'JUP348'], aliases: [] })
    expect(body?.sourceClaims.map(claim => claim.name).sort()).toEqual(['Additional', 'Conflicting'])
    const discoveryClaims = claims.map(claim => ({ ...claim, naifId: known.body.naifId }))
    const resolved = makeSatelliteCatalog({ ...report, commentBodies: discoveryClaims }).find(body => body.naifId === known.body.naifId)
    expect(resolved).toMatchObject({ name: 'Known', aliases: ['S/2025 J1'], sourceEphemerides: ['JUP347', 'JUP348'] })
    expect(resolved?.sourceClaims).toHaveLength(2)
    expect(makeSatelliteCatalog({ ...report, commentBodies: [...discoveryClaims].reverse() })).toEqual(makeSatelliteCatalog({ ...report, commentBodies: discoveryClaims }))
    expect(() => makeSatelliteCatalog({ ...report, commentBodies: [{ ...comment, parentNaifId: 699 }] })).toThrow('parent')
  })
})
