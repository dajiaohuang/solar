import { describe, expect, it } from 'vitest'
import { defaultSelectedBodyIds, majorBodies, majorBodiesById } from '../../src/data/majorBodies'
import { bodyNaifId } from '../../src/data/ephemerisTargets'
import { SATELLITE_IDENTITIES, SOURCE_ONLY_IDENTITIES, satelliteIdentity, satelliteSearchTerms } from '../../src/data/satelliteIdentities'
import { EPHEMERIS_MANIFEST, kernelFilesForBodies } from '../../src/engine/ephemeris/kernelStore'

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
    // Source-backed JUP347 fallback seeds are represented separately from the
    // inventory-only partition, which remains stable as batches are expanded.
    expect(additions.length).toBe(382)
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

  it('exposes explicit source-only small-body identities without a state target', () => {
    expect(SOURCE_ONLY_IDENTITIES.map(entry => entry.naifId).sort()).toEqual([120000617, 920000617])
    for (const entry of SOURCE_ONLY_IDENTITIES) {
      expect(entry).toMatchObject({ naifId: entry.naifId, ephemerisStatus: 'source-only-missing-compatible-system', systemNaifId: 20000617 })
      for (const field of ['orbit', 'radiusKm', 'massKg']) expect(entry).not.toHaveProperty(field)
      const body = majorBodiesById.get(entry.id)
      expect(body).toMatchObject({ id: entry.id, naifId: entry.naifId, source: 'jpl-satellite-inventory', kind: 'asteroid' })
      expect(body?.orbit).toBeUndefined()
      expect(body?.radiusKm).toBeUndefined()
      expect(defaultSelectedBodyIds).not.toContain(entry.id)
    }
  })

  it('binds every numeric identity to an explicit selected-profile SPK target', () => {
    const byId = new Map(EPHEMERIS_MANIFEST.files.map(file => [file.id, file]))
    const numeric = SATELLITE_IDENTITIES.filter(entry => Number.isSafeInteger(entry.naifId))
    expect(numeric).toHaveLength(471)
    for (const entry of numeric) {
      const ids = kernelFilesForBodies([{ id: entry.id, naifId: entry.naifId }])
      const roots = ids.map(id => byId.get(id)).filter(file => file && !file.dependencyOnly)
      expect(roots.some(file => file?.targets.includes(entry.naifId as number)), entry.id).toBe(true)
    }
  })
})
