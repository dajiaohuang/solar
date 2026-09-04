import { describe, expect, it } from 'vitest'
import { inventoryKernels } from '../../scripts/lib/inventory-kernels.mjs'

describe('inventory does not confuse source membership with SPK coverage', () => {
  it('resolves only explicit identities, including the correct satellite parent', async () => {
    const kernels = await inventoryKernels(process.cwd(), 841752000)
    const phobos = { id: 'sat:planet:mars:iau:I', category: 'moon', name: 'Phobos', parentId: 'naif:499' }
    expect(kernels.attach(phobos)).toMatchObject({ naifId: 401, ephemerisStatus: 'state-available-at-audit-epoch' })
    expect(kernels.attach({ ...phobos, parentId: 'naif:599' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.attach({ id: 'sb:asteroid:1', designation: '1', category: 'dwarf-planet' })).toMatchObject({ naifId: 2000001, ephemerisStatus: 'state-available-at-audit-epoch' })
    expect(kernels.attach({ id: 'sb:asteroid:136199', designation: '136199', category: 'dwarf-planet' })).toMatchObject({ naifId: 920136199, ephemerisStatus: 'state-available-at-audit-epoch' })
    expect(kernels.attach({ id: 'sb:asteroid:136108', designation: '136108', category: 'dwarf-planet' })).toMatchObject({ naifId: 920136108, ephemerisStatus: 'state-available-at-audit-epoch' })
    expect(kernels.attach({ id: 'sb:asteroid:136472', designation: '136472', category: 'dwarf-planet' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
  })
  it('labels an explicit ID outside its time window as unavailable', async () => {
    const kernels = await inventoryKernels(process.cwd(), -1e10)
    expect(kernels.attach({ id: 'naif:499', category: 'planet' })).toMatchObject({ naifId: 499, ephemerisStatus: 'no-state-at-audit-epoch', kernelEvidence: { stateAtAuditEpoch: null } })
  })
  it('uses catalog parent evidence for five-digit IDs and keeps identity separate from state', async () => {
    const kernels = await inventoryKernels(process.cwd(), 841752000)
    const record = { id: 'sat:planet:saturn:provisional:S/2009 S2', name: 'S/2009 S2', category: 'moon', parentId: 'naif:699' }
    expect(kernels.attach(record)).toMatchObject({ naifId: 65304, ephemerisStatus: 'no-state-at-audit-epoch' })
    expect(kernels.attach({ ...record, parentId: 'naif:599' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.attach({ ...record, id: 'naif:65304', parentId: 'naif:599' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.attach({ ...record, id: 'alias-only', name: 'S/2000 J8', parentId: 'naif:599' }).naifId).toBe(519)
    expect(kernels.attach({ ...record, id: 'alias-only', name: 'S/2003 J17', parentId: 'naif:599' }).naifId).toBe(550)
    expect(kernels.attach({ ...record, id: 'unknown', name: 'S/2009 S1' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.evidence.satelliteCatalogSha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
