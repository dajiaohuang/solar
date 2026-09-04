import { describe, expect, it } from 'vitest'
import { SMALL_BODY_SATELLITE_SOURCES, smallBodySatelliteIdentities, smallBodyPrimaryIdentity } from '../../scripts/lib/small-body-satellites.mjs'
import { majorBodiesById } from '../../src/data/majorBodies'
import { SMALL_BODY_PRIMARIES, satelliteIdentity, satelliteSearchTerms } from '../../src/data/satelliteIdentities'

const selection = SMALL_BODY_SATELLITE_SOURCES[1]
const record = {
  source: { source: `https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/${selection.id}.bsp` },
  comments: 'Haumea 920136108 2.644E+02 1 15 SATORBINT\nHiiaka 120136108 1.151E+00 1 15 SATORBINT\nNamaka 220136108 3.553E-02 1 15 SATORBINT',
  segments: [
    { target: 920136108, center: 20136108, type: 2, frame: 1 },
    { target: 120136108, center: 20136108, type: 2, frame: 1 },
    { target: 220136108, center: 20136108, type: 2, frame: 1 },
    { target: 20136108, center: 10, type: 21, frame: 1 },
  ],
}
const sha = 'a'.repeat(64)

describe('source-backed small-body satellite identities', () => {
  it('requires the named primary, component and system descriptors without inferring masses', () => {
    const result = smallBodySatelliteIdentities(selection, record, sha)
    expect(result.map(body => body.naifId)).toEqual([120136108, 220136108])
    for (const body of result) {
      expect(body).toMatchObject({ primaryNaifId: 920136108, systemNaifId: 20136108, parentId: 'haumea', sourceSha256: sha })
      for (const field of ['gm', 'massKg', 'radiusKm', 'orbit']) expect(body).not.toHaveProperty(field)
    }
    expect(() => smallBodySatelliteIdentities({ ...selection, primary: selection.system, system: selection.primary }, record, sha)).toThrow()
    expect(() => smallBodySatelliteIdentities(selection, { ...record, comments: record.comments.replace('Hiiaka', 'Wrong') }, sha)).toThrow('name/number')
    expect(() => smallBodySatelliteIdentities(selection, { ...record, segments: record.segments.slice(0, 3) }, sha)).toThrow('center chain')
    expect(() => smallBodySatelliteIdentities(selection, { ...record, source: { source: 'https://example.com/source.bsp' } }, sha)).toThrow('source identity')
  })

  it('makes the three source identities searchable without an invented fallback orbit', () => {
    for (const [target, parent] of [[120136199, 'eris'], [120136108, 'haumea'], [220136108, 'haumea']] as const) {
      const body = majorBodiesById.get(`naif:${target}`)!
      expect(body).toMatchObject({ naifId: target, parentId: parent, kind: 'moon' })
      expect(body.orbit).toBeUndefined()
      expect(satelliteIdentity(body)?.identityStatus).toBe('source-identified-not-in-discovery-snapshot')
    }
    expect(satelliteSearchTerms(majorBodiesById.get('naif:120136108')!)).toContain('Hiiaka')
  })

  it('retains five explicit primary identities without promoting barycenters or source constants', () => {
    expect(SMALL_BODY_PRIMARIES).toHaveLength(5)
    for (const primary of SMALL_BODY_PRIMARIES) {
      const body = majorBodiesById.get(primary.id)!
      expect(body).toMatchObject({ naifId: primary.naifId, kind: 'asteroid' })
      expect(body.naifId).not.toBe(primary.systemNaifId)
      for (const field of ['orbit', 'radiusKm', 'massKg']) expect(body).not.toHaveProperty(field)
      expect(satelliteSearchTerms(body)).toContain(primary.designation)
    }
    const sat1 = [...majorBodiesById.values()].filter(body => body.shortName?.endsWith(' · Sat1'))
    expect(sat1.map(body => body.parentId).sort()).toEqual(['1998ww31', '2001qw322'])
    expect(new Set(sat1.map(body => body.name)).size).toBe(2)
  })

  it('accepts explicitly matched alphanumeric labels but rejects changed designation evidence', () => {
    const binary = SMALL_BODY_SATELLITE_SOURCES.find(entry => entry.parentId === '1998ww31')!
    const original = { source: { source: `https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp/${binary.id}.bsp` },
      comments: '1998ww31 953031823 0.177 1 15 SATORBINT\nSat1 153031823 0 1 15 SATORBINT\nTarget body : (1998 WW31)  {source: Horizons_SPK:JPL#10}',
      segments: [{ target: 953031823, center: 53031823, frame: 1, type: 2 }, { target: 153031823, center: 53031823, frame: 1, type: 2 }, { target: 53031823, center: 10, frame: 1, type: 21 }] }
    expect(smallBodyPrimaryIdentity(binary, original, sha)).toMatchObject({ id: '1998ww31', designation: '1998 WW31', naifId: 953031823 })
    expect(() => smallBodyPrimaryIdentity(binary, { ...original, comments: original.comments.replace('(1998 WW31)', '(2001 QW322)') }, sha)).toThrow('designation')
    expect(() => smallBodySatelliteIdentities(binary, { ...original, comments: original.comments.replace('Sat1', 'Sat2') }, sha)).toThrow('name/number')
    expect(() => smallBodySatelliteIdentities({ ...binary, parentName: '.*' }, original, sha)).toThrow('Invalid explicit')
  })
})
