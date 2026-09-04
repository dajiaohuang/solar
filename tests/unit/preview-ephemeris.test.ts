import { describe, expect, it } from 'vitest'
import pages from '../../src/data/ephemeris-manifest.json'
import full from '../../src/data/ephemeris-manifest-full.json'
import preview from '../../src/data/preview-profile.json'
import { previewBodyTargets, previewEphemerisManifest } from '../../src/data/previewEphemeris'
import { majorBodiesById } from '../../src/data/majorBodies'
import { bodyNaifId } from '../../src/data/ephemerisTargets'

describe('preview scientific delivery closure', () => {
  it('resolves exactly the runtime registry identities, including named TNO primaries', () => {
    expect(previewBodyTargets).toEqual(preview.bodyIds.map(id => ({ id, naifId: bodyNaifId(majorBodiesById.get(id)!) })))
    expect(previewBodyTargets.find(body => body.id === 'quaoar')?.naifId).toBe(920050000)
    expect(previewBodyTargets.find(body => body.id === 'makemake')?.naifId).toBeUndefined()
  })

  it('retains original coefficients, order, source pools and explicit gaps without changing full manifests', () => {
    const before = JSON.stringify([pages, full])
    const selected = previewEphemerisManifest(pages)
    expect(selected.files).toHaveLength(36)
    expect(selected.files.reduce((sum, file) => sum + file.bytes, 0)).toBe(90800128)
    const ids = new Set(selected.files.map(file => file.id))
    expect(ids.has('de442-satellite-2020-2031')).toBe(true)
    for (const file of selected.files) {
      expect(file).toBe(pages.files.find(candidate => candidate.id === file.id))
      for (const dependency of ('solutionKernelIds' in file ? file.solutionKernelIds : []) ?? []) expect(ids.has(dependency)).toBe(true)
    }
    expect(selected.bodyTargets.find(body => body.id === 'makemake')?.naifId).toBeNull()
    expect(JSON.stringify([pages, full])).toBe(before)
  })

  it('fails closed for missing dependencies, duplicate identities and dependency cycles', () => {
    const root = { id: 'root', targets: [10], solutionKernelIds: ['dependency'] }
    expect(() => previewEphemerisManifest({ id: 'test', files: [root] })).toThrow(/Missing/)
    expect(() => previewEphemerisManifest({ id: 'test', files: [root, root] })).toThrow(/Duplicate/)
    expect(() => previewEphemerisManifest({ id: 'test', files: [root, { id: 'dependency', targets: [], solutionKernelIds: ['root'] }] })).toThrow(/Cyclic/)
  })
})
