import { describe, expect, it } from 'vitest'
import { SMALL_BODY_SATELLITE_SOURCES, smallBodySatelliteIdentities } from '../../scripts/lib/small-body-satellites.mjs'
import { majorBodiesById } from '../../src/data/majorBodies'
import { satelliteIdentity, satelliteSearchTerms } from '../../src/data/satelliteIdentities'

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
})
