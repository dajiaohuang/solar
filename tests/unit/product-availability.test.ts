import { describe, expect, it } from 'vitest'
import { bodyAvailability, catalogAvailability, productProfile, routeAvailability, sceneAvailability, storyAvailability, PREVIEW_PROFILE } from '../../src/lib/productAvailability'
import { availabilityActions, availabilityStore } from '../../src/state/availability-store'
import { SCENE_PRESETS } from '../../src/data/presets'
import { buildScenePresetUrlState } from '../../src/lib/scenePreset'
import { majorBodies } from '../../src/data/majorBodies'

describe('product availability is not scientific coverage', () => {
  it('keeps full unrestricted and rejects unknown configurations', () => {
    expect(productProfile()).toBe('full')
    expect(productProfile('preview')).toBe('preview')
    expect(() => productProfile('typo')).toThrow(/Unknown/)
    expect(sceneAvailability({ bodies: ['unknown'], route: 'mission', history: 1e9 }, 'full').available).toBe(true)
  })

  it('declares real curated identities, not made-up full-version destinations', () => {
    expect(new Set(PREVIEW_PROFILE.bodyIds).size).toBe(PREVIEW_PROFILE.bodyIds.length)
    const ids = new Set(majorBodies.map(body => body.id))
    for (const id of PREVIEW_PROFILE.bodyIds) expect(ids.has(id), id).toBe(true)
    expect(Object.values(PREVIEW_PROFILE.fullDestinations)).toEqual([null, null, null])
    // Availability permits inspection of a known data gap; it asserts no state.
    expect(bodyAvailability('makemake', 'preview').available).toBe(true)
    expect(bodyAvailability('naif:65297', 'preview')).toEqual({ available: false, reason: 'body', resource: 'naif:65297' })
  })

  it('retains core planet, moon, binary and main-belt scenes', () => {
    for (const id of ['today', 'earth-moon', 'inner-system', 'outer-system', 'mars-spk-moons', 'quaoar-spk-moons', 'jupiter-galilean-moons', 'saturn-titan', 'large-asteroid-ephemerides', 'mars-main-belt-jupiter']) {
      const preset = SCENE_PRESETS.find(item => item.id === id)!
      expect(preset, id).toBeDefined()
      expect(sceneAvailability(buildScenePresetUrlState(preset, 'en'), 'preview'), id).toEqual({ available: true })
    }
    for (const id of ['jupiter-spk-moons', 'saturn-spk-moons']) {
      expect(sceneAvailability(buildScenePresetUrlState(SCENE_PRESETS.find(item => item.id === id)!, 'zh'), 'preview').available).toBe(false)
    }
  })

  it('checks references, hidden focus, stories, sample identity and heavy tools', () => {
    for (const key of ['ref', 'compareRef', 'focused', 'missionFrom', 'missionTo'] as const) expect(sceneAvailability({ [key]: 'naif:65297' }, 'preview').available).toBe(false)
    expect(routeAvailability('mission', 'preview').available).toBe(false)
    expect(routeAvailability('catalog', 'preview').available).toBe(false)
    expect(storyAvailability('geocentric-model', 'preview').available).toBe(true)
    expect(storyAvailability('voyagers', 'preview').available).toBe(false)
    expect(catalogAvailability('sample', 'preview').available).toBe(true)
    for (const operation of ['scan', 'search', 'details', 'sbdb'] as const) expect(catalogAvailability(operation, 'preview').available).toBe(false)
    expect(sceneAvailability({ history: 4384 }, 'preview').available).toBe(false)
    expect(sceneAvailability({ samples: 480 }, 'preview').available).toBe(false)
    expect(sceneAvailability({ catalogSample: 'desktop', catalogSampleCount: 30000 }, 'preview').available).toBe(false)
    expect(sceneAvailability({ layers: ['spacecraft'] }, 'preview').available).toBe(false)
  })

  it('never edits a denied request and retains its exact URL across dismissal', () => {
    const scene = { bodies: ['earth', 'naif:65297'], ref: 'sun' }
    const original = structuredClone(scene)
    const url = 'https://dajiaohuang.github.io/solar/?v=4&bodies=earth,naif:65297&view=3d'
    expect(availabilityActions.require(sceneAvailability(scene, 'preview'), url)).toBe(false)
    expect(scene).toEqual(original)
    availabilityActions.dismiss()
    expect(availabilityStore.getState()).toMatchObject({ open: false, requestedSceneUrl: url, preserveLocation: true })
    availabilityActions.explorePreview()
    expect(availabilityStore.getState()).toMatchObject({ requestedSceneUrl: url, preserveLocation: false })
  })
})
