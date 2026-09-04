import { describe, expect, it } from 'vitest'
import { defaultSelectedBodyIds, majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import { bodyNaifId } from '../../src/data/ephemerisTargets'
import { SATELLITE_IDENTITIES, satelliteIdentity, satelliteSearchTerms } from '../../src/data/satelliteIdentities'

describe('selectable satellite identity catalog', () => {
  it('retains every frozen identity exactly once without renaming existing shared IDs', () => {
    expect(SATELLITE_IDENTITIES).toHaveLength(472)
    for (const entry of SATELLITE_IDENTITIES) {
      const bodies = majorBodies.filter(body => entry.naifId === undefined ? body.id === entry.id : bodyNaifId(body) === entry.naifId)
      expect(bodies, entry.id).toHaveLength(1)
      expect(bodies[0].parentId).toBe(entry.parentId)
    }
    expect(majorBodiesById.get('io')?.name).toBe('木卫一')
    expect(majorBodiesById.has('naif:501')).toBe(false)
  })

  it('does not invent orbital or physical data, or automatically select the expanded inventory', () => {
    const additions = majorBodies.filter(body => body.source === 'jpl-satellite-inventory')
    expect(additions.length).toBeGreaterThan(400)
    for (const body of additions) {
      expect(body.orbit).toBeUndefined()
      expect(body.radiusKm).toBeUndefined()
      expect(defaultSelectedBodyIds).not.toContain(body.id)
    }
    expect(defaultSelectedBodyIds).toHaveLength(19)
    expect(additions.filter(body => body.naifId === undefined)).toHaveLength(1)
    expect(satelliteIdentity(majorBodiesById.get('naif:65304')!)?.name).toBe('S/2009 S2')
  })

  it('preserves discovery aliases and distinguishes source-only identities', () => {
    expect(satelliteSearchTerms(majorBodiesById.get('naif:562')!)).toContain('S/2016 J2')
    expect(satelliteIdentity(majorBodiesById.get('io')!)?.name).toBe('Io')
    expect(satelliteIdentity(majorBodiesById.get('naif:55524')!)?.identityStatus).toBe('source-identified-not-in-discovery-snapshot')
  })
})
