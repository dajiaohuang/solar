import { describe, expect, it } from 'vitest'
import { inventoryKernels, snapshotKernelAtEpoch } from '../../scripts/lib/inventory-kernels.mjs'
import { readFileSync } from 'node:fs'
import { SpkKernel } from '../../src/engine/ephemeris/spk'
import { createKernelResolver } from '../../src/engine/ephemeris/kernelPool'
import { analyzeKernelWindow } from '../../scripts/lib/kernel-window-coverage.mjs'

describe('inventory does not confuse source membership with SPK coverage', () => {
  it('retains original one-epoch states and center metadata without retaining coefficient buffers', () => {
    const bytes = readFileSync('tests/fixtures/jup347-himalia-join.bsp')
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const original = new SpkKernel(buffer)
    const et = original.segments[1].startEt
    const expected = original.evaluate(506, et)
    const snapshot = snapshotKernelAtEpoch(original, et)
    expect(snapshot.segments).toEqual(original.segments)
    expect(snapshot.evaluate(506, et)).toEqual(expected)
    expect(snapshot.evaluate(999999, et)).toBeNull()
    const before = createKernelResolver([{ id: 'moon', kernel: original }], et).barycentric(506)
    expect(createKernelResolver([{ id: 'moon', kernel: snapshot as SpkKernel }], et).barycentric(506)).toEqual(before)
    expect(before).toBeNull() // Snapshot does not manufacture the missing center.
    new Uint8Array(buffer).fill(0)
    expect(snapshot.evaluate(506, et)).toEqual(expected)
    expect(() => snapshot.evaluate(506, et + 1)).toThrow('another epoch')
    expect(() => snapshotKernelAtEpoch(original, NaN)).toThrow('Finite')
  })
  it('audits the requested delivery profile without borrowing the full window for Pages', async () => {
    const record = { id: 'naif:706', category: 'moon', parentId: 'naif:799' }
    const et = 900000000 // After the narrow Pages interval, inside full coverage.
    const pages = await inventoryKernels(process.cwd(), et)
    expect(pages.evidence.profile).toBe('pages')
    expect(pages.attach(record).ephemerisStatus).toBe('no-state-at-audit-epoch')
    const full = await inventoryKernels(process.cwd(), et, 'full')
    expect(full.evidence.profile).toBe('full')
    expect(full.attach(record).ephemerisStatus).toBe('state-available-at-audit-epoch')
    for (const kernels of [pages, full]) {
      for (const target of [10, 301, 399, 706, 920136199, 120136199, 999999]) {
        const window = analyzeKernelWindow({ kernels: kernels.descriptors, target, startEt: et, endEt: et })
        expect(window.gaps.length === 0).toBe(kernels.attach({ id: `naif:${target}`, category: 'fixture' }).ephemerisStatus === 'state-available-at-audit-epoch')
      }
    }
    await expect(inventoryKernels(process.cwd(), et, 'unknown')).rejects.toThrow('Unknown')
  })
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
  it('keeps small-body moons attached to the named primary identity, not another system', async () => {
    const kernels = await inventoryKernels(process.cwd(), 841752000)
    const record = { id: 'naif:120136199', category: 'moon', parentId: 'sb:asteroid:136199', name: 'Dysnomia' }
    expect(kernels.attach(record)).toMatchObject({ naifId: 120136199, ephemerisStatus: 'state-available-at-audit-epoch' })
    expect(kernels.attach({ ...record, parentId: 'sb:asteroid:136108' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    for (const [designation, primary, companion, name] of [['50000', 920050000, 120050000, 'Weywot'], ['90482', 920090482, 120090482, 'Vanth'], ['120347', 920120347, 120120347, 'Actaea'], ['1998 WW31', 953031823, 153031823, '1998 WW31 · Sat1'], ['2001 QW322', 953092511, 153092511, '2001 QW322 · Sat1'], ['469705', 920469705, 120469705, 'Haunu'], ['612095', 920612095, 120612095, '1999 OJ4 · Sat1'], ['612687', 920612687, 120612687, '2003 UN284 · Sat1']] as const) {
      const id = `sb:asteroid:${designation}`
      expect(kernels.attach({ id, designation, category: 'asteroid' })).toMatchObject({ naifId: primary, ephemerisStatus: 'state-available-at-audit-epoch' })
      expect(kernels.attach({ id: `naif:${companion}`, category: 'moon', parentId: id, name })).toMatchObject({ naifId: companion, ephemerisStatus: 'state-available-at-audit-epoch' })
      expect(kernels.attach({ id: `naif:${companion}`, category: 'moon', parentId: 'sb:asteroid:136199', name }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    }
  })
  it('uses catalog parent evidence for five-digit IDs and keeps identity separate from state', async () => {
    const kernels = await inventoryKernels(process.cwd(), 841752000)
    const record = { id: 'sat:planet:saturn:provisional:S/2009 S2', name: 'S/2009 S2', category: 'moon', parentId: 'naif:699' }
    expect(kernels.attach(record)).toMatchObject({ naifId: 65304, ephemerisStatus: 'state-available-at-audit-epoch' })
    expect(kernels.attach({ ...record, parentId: 'naif:599' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.attach({ ...record, id: 'naif:65304', parentId: 'naif:599' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.attach({ ...record, id: 'alias-only', name: 'S/2000 J8', parentId: 'naif:599' }).naifId).toBe(519)
    expect(kernels.attach({ ...record, id: 'alias-only', name: 'S/2003 J17', parentId: 'naif:599' }).naifId).toBe(550)
    expect(kernels.attach({ ...record, id: 'unknown', name: 'S/2009 S1' }).ephemerisStatus).toBe('not-mapped-to-bundled-kernel')
    expect(kernels.evidence.satelliteCatalogSha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
